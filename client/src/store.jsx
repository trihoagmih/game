import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { socket, request, storage, AUTH_ERRORS } from './socket.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const roomFromHash = () => {
  const m = location.hash.match(/^#\/room\/([\w-]+)/);
  return m ? m[1] : null;
};

export function AppProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [room, setRoom] = useState(null); // trạng thái phòng hiện tại
  const [toasts, setToasts] = useState([]);
  // Luồng vào app — một trạng thái duy nhất để các màn hình không giành nhau (tránh nhấp nháy):
  //   connecting → (auth → checking) → (name | entering) → ready
  const [phase, setPhase] = useState('connecting');
  const [busy, setBusy] = useState(0); // số yêu cầu đang chờ server trả lời
  const [server, setServer] = useState(null); // { id, name, gated } — server (sảnh) đang vào
  const [newVersion, setNewVersion] = useState(null); // phiên bản mới trên server, khác bản đang chạy
  const [authError, setAuthError] = useState(null); // null = chưa bị chặn; chuỗi = cần nhập mật khẩu
  const receivedAt = useRef(0);

  const toast = useCallback((text, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-4), { id, text, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 4000 : 2500);
  }, []);

  const hello = useCallback(async (name) => {
    const res = await request('hello', { token: storage.token, tokens: storage.tokens, name: name || storage.name });
    storage.setServerToken(res.server.id, res.token);
    setServer(res.server);
    storage.name = res.user.name;
    setUser(res.user);
    setRooms(res.rooms);
    setPhase('ready');
    const wanted = roomFromHash();
    if (!res.roomId && wanted) {
      try {
        const r = await request('room:join', { roomId: wanted, mode: 'watch' });
        if (r.warning) toast(r.warning);
      } catch (e) {
        toast(e.message, 'error');
        location.hash = '';
      }
    }
    if (!res.roomId && !wanted) setRoom(null);
    return res;
  }, [toast]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setAuthError(null);
      if (storage.name) {
        setPhase((ph) => (ph === 'ready' ? ph : 'entering'));
        hello().catch((e) => { toast(e.message, 'error'); setPhase('name'); });
      } else {
        setPhase('name');
      }
    };
    const onDisconnect = () => setConnected(false);
    // Middleware auth từ chối: socket.io không tự thử lại, phải nhập mật khẩu rồi connect lại
    const onConnectError = (err) => {
      if (!AUTH_ERRORS[err.message]) return;
      if (err.message !== 'AUTH_LOCKED') storage.password = '';
      setAuthError(err.message);
      setPhase('auth');
    };
    const onRooms = (list) => setRooms(list);
    const onState = (s) => {
      receivedAt.current = performance.now();
      setRoom({ ...s, receivedAt: receivedAt.current });
      if (roomFromHash() !== s.id) location.hash = `#/room/${s.id}`;
    };
    const onClosed = ({ reason }) => {
      setRoom(null);
      location.hash = '';
      if (reason) toast(reason, 'error');
    };
    const onLeft = () => { setRoom(null); location.hash = ''; };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    // Server báo phiên bản client nó đang phục vụ; khác bản đang chạy → có bản deploy mới
    const onVersion = ({ version }) => {
      if (version && __APP_VERSION__ && version !== __APP_VERSION__) setNewVersion(version);
    };
    socket.on('app:version', onVersion);
    socket.on('lobby:rooms', onRooms);
    socket.on('room:state', onState);
    socket.on('room:closed', onClosed);
    socket.on('room:left', onLeft);
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('app:version', onVersion);
      socket.off('lobby:rooms', onRooms);
      socket.off('room:state', onState);
      socket.off('room:closed', onClosed);
      socket.off('room:left', onLeft);
      socket.disconnect();
    };
  }, [hello, toast]);

  // Điều hướng bằng nút back của trình duyệt
  useEffect(() => {
    const onHash = () => {
      if (!roomFromHash() && room) request('room:leave').catch(() => {});
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [room]);

  /**
   * Gọi server, tự hiện lỗi dạng toast.
   * Bấm lặp lại cùng một hành động khi yêu cầu trước chưa xong thì dùng chung kết quả (chống bấm đúp).
   */
  const inflight = useRef(new Map());
  const call = useCallback((event, payload) => {
    const key = event + JSON.stringify(payload ?? null);
    const running = inflight.current.get(key);
    if (running) return running;
    setBusy((n) => n + 1);
    const p = request(event, payload)
      .then((res) => {
        if (res.warning) toast(res.warning);
        return res;
      })
      .catch((e) => {
        toast(e.message, 'error');
        return null;
      })
      .finally(() => {
        inflight.current.delete(key);
        setBusy((n) => n - 1);
      });
    inflight.current.set(key, p);
    return p;
  }, [toast]);

  const act = useCallback((payload) => call('game:action', payload), [call]);

  const login = useCallback((password) => {
    storage.password = password;
    setPhase('checking');
    socket.connect();
  }, []);

  /** Rời server hiện tại để nhập mật khẩu của server khác. */
  const switchServer = useCallback(async () => {
    if (room) await request('room:leave').catch(() => {});
    storage.password = '';
    location.hash = '';
    socket.disconnect();
    setRoom(null);
    setUser(null);
    setRooms([]);
    setServer(null);
    setAuthError('AUTH_REQUIRED');
    setPhase('auth');
  }, [room]);

  const value = useMemo(() => ({
    connected, user, setUser, rooms, room, toasts, toast, phase, busy, hello, call, act, authError, login, newVersion, server, switchServer,
  }), [newVersion, server, switchServer, connected, user, rooms, room, toasts, toast, phase, busy, hello, call, act, authError, login]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
