import { useCallback, useEffect, useRef, useState } from 'react';
import { socket, request } from './socket.js';
import { voiceNegotiation } from './voiceNegotiation.js';

/**
 * Voice chat trong phòng — WebRTC mesh: mỗi cặp người một RTCPeerConnection, âm thanh đi thẳng giữa
 * các trình duyệt (mã hóa DTLS-SRTP), server chỉ chuyển tín hiệu SDP/ICE.
 * Dùng mẫu "perfect negotiation" (https://w3c.github.io/webrtc-pc/#perfect-negotiation-example):
 * hai bên đều có thể gửi offer, bên "polite" (id lớn hơn) nhường khi va chạm.
 */
const VOL_KEY = 'gl_voice_vol';
const loadVolumes = () => { try { return JSON.parse(localStorage.getItem(VOL_KEY) || '{}') || {}; } catch { return {}; } };
const SPEAK_ON = 0.035; // ngưỡng RMS coi là đang nói (có trễ để không nhấp nháy)
const SPEAK_OFF = 0.02;

export function useVoice({ room, me, status, toast }) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [micOk, setMicOk] = useState(true); // false = không có micro → chỉ nghe
  const [speaking, setSpeaking] = useState(() => new Set());
  const [peerState, setPeerState] = useState({}); // id → 'connecting' | 'connected' | 'failed'
  const [volumes, setVolumes] = useState(loadVolumes);
  const R = useRef({ joined: false, joining: false, generation: 0, pending: [], joinedAt: 0, stream: null, ice: [], peers: new Map(), ctx: null, meters: new Map(), timer: null, unlock: null });
  const meRef = useRef(me);
  meRef.current = me;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const send = (to, data) => request('voice:signal', { to, data }).catch(() => {});

  // ---------- Đo âm lượng để biết ai đang nói ----------
  const meter = useCallback((id, stream) => {
    const r = R.current;
    try {
      if (!r.ctx) r.ctx = new (window.AudioContext || window.webkitAudioContext)();
      r.ctx.resume?.().catch(() => {});
      r.meters.get(id)?.src.disconnect();
      const src = r.ctx.createMediaStreamSource(stream);
      const an = r.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      r.meters.set(id, { src, an, buf: new Float32Array(an.fftSize), on: false });
    } catch { /* trình duyệt không hỗ trợ → bỏ qua chỉ báo */ }
    if (!r.timer) {
      r.timer = setInterval(() => {
        let changed = false;
        const next = new Set();
        for (const [mid, m] of r.meters) {
          m.an.getFloatTimeDomainData(m.buf);
          let sum = 0;
          for (let i = 0; i < m.buf.length; i++) sum += m.buf[i] * m.buf[i];
          const rms = Math.sqrt(sum / m.buf.length);
          const live = mid !== meRef.current || r.stream?.getAudioTracks()[0]?.enabled;
          const on = live && (m.on ? rms > SPEAK_OFF : rms > SPEAK_ON);
          if (on !== m.on) { m.on = on; changed = true; }
          if (on) next.add(mid);
        }
        if (changed) setSpeaking(next);
      }, 150);
    }
  }, []);

  const unmeter = (id) => {
    const r = R.current;
    r.meters.get(id)?.src.disconnect();
    r.meters.delete(id);
  };

  // iOS/Safari có thể chặn tự phát âm thanh → chờ lần chạm kế tiếp rồi phát lại
  const playSafe = (audio) => {
    audio.play().catch(() => {
      const r = R.current;
      if (r.unlock) return;
      r.unlock = () => {
        r.unlock = null;
        r.ctx?.resume?.().catch(() => {});
        for (const p of r.peers.values()) playSafe(p.audio);
      };
      document.addEventListener('pointerdown', r.unlock, { once: true });
      toastRef.current?.('Chạm vào màn hình để bật âm thanh kênh thoại');
    });
  };

  // ---------- Kết nối với từng người ----------
  const closePeer = useCallback((id) => {
    const r = R.current;
    const p = r.peers.get(id);
    if (!p) return;
    r.peers.delete(id);
    clearTimeout(p.recovery);
    try { p.pc.close(); } catch { /* đã đóng */ }
    p.audio.srcObject = null;
    unmeter(id);
    setPeerState((s) => { const n = { ...s }; delete n[id]; return n; });
  }, []);

  const createPeer = useCallback((id) => {
    const r = R.current;
    const pc = new RTCPeerConnection({ iceServers: r.ice });
    const audio = new Audio();
    audio.autoplay = true;
    audio.playsInline = true;
    audio.volume = Math.max(0, Math.min(1, loadVolumes()[id] ?? 1));
    const p = { pc, audio, createdAt: Date.now(), recovery: null };
    p.negotiation = voiceNegotiation(pc, meRef.current > id, (data) => send(id, data));
    r.peers.set(id, p);
    if (r.stream) for (const t of r.stream.getTracks()) pc.addTrack(t, r.stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.onnegotiationneeded = async () => {
      try {
        await p.negotiation.negotiate();
      } catch (e) {
        console.warn('voice offer', e);
      }
    };
    pc.onicecandidate = ({ candidate }) => send(id, { candidate: candidate ? candidate.toJSON() : null });
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      audio.srcObject = stream;
      playSafe(audio);
      meter(id, stream);
      track.onunmute = () => playSafe(audio);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (r.peers.get(id) !== p) return;
      clearTimeout(p.recovery);
      setPeerState((s) => ({ ...s, [id]: st === 'connected' ? 'connected' : st === 'failed' ? 'failed' : 'connecting' }));
      if (st === 'failed') pc.restartIce?.();
      if (st === 'disconnected') p.recovery = setTimeout(() => {
        if (r.peers.get(id) === p && pc.connectionState === 'disconnected') pc.restartIce?.();
      }, 5000);
    };
    setPeerState((s) => ({ ...s, [id]: 'connecting' }));
    return p;
  }, [meter]);

  // Tín hiệu từ người khác
  useEffect(() => {
    const onSignal = async (signal) => {
      const { from, data } = signal;
      const r = R.current;
      if (!from || from === meRef.current) return;
      if (!r.joined) {
        if (r.joining && r.pending.length < 1024) r.pending.push(signal);
        return;
      }
      const p = r.peers.get(from) || createPeer(from);
      try {
        await p.negotiation.receive(data);
      } catch (e) {
        console.warn('voice signal', e);
      }
    };
    socket.on('voice:signal', onSignal);
    R.current.onSignal = onSignal;
    return () => { socket.off('voice:signal', onSignal); R.current.onSignal = null; };
  }, [createPeer]);

  const teardown = useCallback(() => {
    const r = R.current;
    r.joined = false;
    r.joining = false;
    r.generation++;
    r.pending = [];
    for (const id of [...r.peers.keys()]) closePeer(id);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.stream = null;
    unmeter(meRef.current);
    clearInterval(r.timer);
    r.timer = null;
    if (r.unlock) document.removeEventListener('pointerdown', r.unlock);
    r.unlock = null;
    r.ctx?.close?.().catch(() => {});
    r.ctx = null;
    setJoined(false);
    setJoining(false);
    setSpeaking(new Set());
    setPeerState({});
  }, [closePeer]);

  useEffect(() => {
    socket.on('disconnect', teardown);
    return () => socket.off('disconnect', teardown);
  }, [teardown]);

  // Đồng bộ danh sách kết nối với danh sách người trong kênh thoại của phòng
  const voiceIds = (room?.voice || []).map((v) => v.id).join(',');
  useEffect(() => {
    const r = R.current;
    if (!r.joined) return;
    const ids = new Set(voiceIds ? voiceIds.split(',') : []);
    // Server đã đưa mình ra (tắt voice chat, mất kết nối…) → dọn phía mình
    if (!ids.has(meRef.current) && Date.now() - r.joinedAt > 3000) { teardown(); return; }
    for (const id of ids) if (id !== meRef.current && !r.peers.has(id)) createPeer(id);
    for (const [id, p] of r.peers) if (!ids.has(id) && Date.now() - p.createdAt > 3000) closePeer(id);
  }, [voiceIds, createPeer, closePeer, teardown]);

  // Voice chat bị tắt trên server → rời kênh
  useEffect(() => {
    if (status && !status.enabled && R.current.joined) {
      teardown();
      if (status.reason) toastRef.current?.(status.reason, 'error');
    }
  }, [status, teardown]);

  // Rời phòng / đóng trang → dọn kết nối, tắt micro
  useEffect(() => () => teardown(), [teardown]);

  const join = useCallback(async () => {
    const r = R.current;
    if (r.joined || r.joining) return;
    if (!window.RTCPeerConnection) { toastRef.current?.('Trình duyệt này không hỗ trợ voice chat', 'error'); return; }
    setJoining(true);
    r.joining = true;
    const generation = ++r.generation;
    // Tạo AudioContext ngay trong lần bấm (iOS chỉ cho phát âm thanh sau thao tác của người dùng)
    try { r.ctx = r.ctx || new (window.AudioContext || window.webkitAudioContext)(); r.ctx.resume?.(); } catch { /* bỏ qua */ }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch {
      toastRef.current?.('Không dùng được micro — bạn vẫn nghe được mọi người', 'error');
    }
    if (generation !== r.generation) { stream?.getTracks().forEach((t) => t.stop()); return; }
    try {
      const res = await request('voice:join', { muted: !stream });
      if (generation !== r.generation) { stream?.getTracks().forEach((t) => t.stop()); return; }
      r.ice = res.iceServers || [];
      r.stream = stream;
      r.joined = true;
      r.joinedAt = Date.now();
      setJoined(true);
      setMicOk(!!stream);
      setMuted(!stream);
      if (stream) stream.getAudioTracks()[0].onended = () => {
        if (r.stream !== stream || !r.joined) return;
        setMicOk(false);
        setMuted(true);
        request('voice:mute', { muted: true }).catch(() => {});
        toastRef.current?.('Micro đã ngắt. Bấm Thử lại micro để kết nối lại.', 'error');
      };
      if (stream) meter(meRef.current, stream);
      for (const id of res.peers || []) if (!r.peers.has(id)) createPeer(id);
      for (const signal of r.pending.splice(0)) r.onSignal?.(signal);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (generation !== r.generation) return;
      teardown();
      toastRef.current?.(e.message, 'error');
    } finally {
      if (generation === r.generation) { r.joining = false; setJoining(false); }
    }
  }, [meter, createPeer, teardown]);

  const leave = useCallback(() => {
    if (!R.current.joined) return;
    teardown();
    request('voice:leave').catch(() => {});
  }, [teardown]);

  const toggleMute = useCallback(async () => {
    const r = R.current;
    const track = r.stream?.getAudioTracks()[0];
    if (!r.joined || r.micPending) return;
    if (!track || track.readyState === 'ended') {
      r.micPending = true;
      setJoining(true);
      const generation = r.generation;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        if (!r.joined || generation !== r.generation) { stream.getTracks().forEach((t) => t.stop()); return; }
        const next = stream.getAudioTracks()[0];
        for (const p of r.peers.values()) {
          const sender = p.pc.getSenders().find((s) => s.track?.kind === 'audio');
          if (sender) await sender.replaceTrack(next);
          else p.pc.addTrack(next, stream);
        }
        if (!r.joined || generation !== r.generation) { stream.getTracks().forEach((t) => t.stop()); return; }
        r.stream?.getTracks().forEach((t) => t.stop());
        r.stream = stream;
        next.onended = () => {
          if (r.stream !== stream || !r.joined) return;
          setMicOk(false);
          setMuted(true);
          request('voice:mute', { muted: true }).catch(() => {});
        };
        meter(meRef.current, stream);
        setMicOk(true);
        setMuted(false);
        await request('voice:mute', { muted: false });
      } catch (e) {
        if (stream && r.stream !== stream) stream.getTracks().forEach((t) => t.stop());
        toastRef.current?.(`Không bật được micro: ${e.message}`, 'error');
      } finally {
        r.micPending = false;
        if (generation === r.generation) setJoining(false);
      }
      return;
    }
    const m = !muted;
    track.enabled = !m;
    setMuted(m);
    request('voice:mute', { muted: m }).catch(() => {});
  }, [muted, meter]);

  const setVolume = useCallback((id, v) => {
    const p = R.current.peers.get(id);
    if (p) p.audio.volume = v;
    setVolumes((all) => {
      const next = { ...all, [id]: v };
      try { localStorage.setItem(VOL_KEY, JSON.stringify(next)); } catch { /* bộ nhớ đầy / chặn */ }
      return next;
    });
  }, []);

  return {
    available: !!status?.enabled,
    me,
    status, joined, joining, muted, micOk, speaking, peerState, volumes,
    members: room?.voice || [],
    join, leave, toggleMute, setVolume,
  };
}
