import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { ArrowLeft, Pencil, Link, Keyboard, Trash2, Eye, Check, Info, MessageCircle, Users, MoreVertical, X, Crown, Headphones, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { useVoice } from '../voice.js';
import { RoomUICtx } from './GameInfo.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { GAME_META, GameIcon } from './Lobby.jsx';
import { turnInfo, TurnPill, TurnEffects } from './Turn.jsx';
import Modal from './Modal.jsx';
import XiangqiGame from '../games/XiangqiGame.jsx';
import PokerGame from '../games/PokerGame.jsx';
import TalaGame from '../games/TalaGame.jsx';
import CaroGame from '../games/CaroGame.jsx';
import SamLocGame from '../games/SamLocGame.jsx';
import WordChainGame from '../games/WordChainGame.jsx';
import ScribbleGame from '../games/ScribbleGame.jsx';
import TelephoneGame from '../games/TelephoneGame.jsx';
import OnetGame from '../games/OnetGame.jsx';
import QuizGame from '../games/QuizGame.jsx';
import WordGuessGame from '../games/WordGuessGame.jsx';
import FairnessBadge from './FairnessBadge.jsx';
import { useHotkeys } from '../hooks.js';

const GAME_COMPONENT = {
  xiangqi: XiangqiGame, poker: PokerGame, tala: TalaGame, caro: CaroGame, samloc: SamLocGame, wordchain: WordChainGame,
  scribble: ScribbleGame, telephone: TelephoneGame, onet: OnetGame, quiz: QuizGame, wordguess: WordGuessGame,
};

export const SHORTCUTS = {
  poker: [
    ['F', 'Bỏ bài (Fold)'], ['C', 'Theo / Check (Call)'], ['K', 'Check'], ['B', 'Cược (Bet)'], ['R', 'Tố (Raise)'],
    ['A', 'All-in'], ['↑ / ↓', 'Tăng / giảm mức cược 1 BB'], ['Shift + ↑/↓', 'Tăng / giảm 10 BB'],
    ['1 / 2 / 3 / 4', 'Mức cược ⅓ pot / ½ pot / ¾ pot / pot'], ['Enter', 'Xác nhận cược/tố'],
    ['H', 'Mở Hands log (ván vừa xong)'], ['T', 'Rabbit hunt (khi ván kết thúc sớm)'], ['← / →', 'Ván trước / ván sau trong Hands log'],
  ],
  tala: [
    ['D / Space', 'Bốc bài (khi tới lượt bốc)'], ['E', 'Ăn bài'], ['← / →', 'Di chuyển giữa các lá'],
    ['↑ / Space', 'Chọn / bỏ chọn lá đang trỏ'], ['Enter', 'Đánh lá đang chọn'], ['H', 'Hạ phỏm với các lá đã chọn'],
    ['X', 'Hạ tự động'], ['G', 'Gửi lá đang chọn'], ['U', 'Ù'], ['S', 'Xếp bài (theo hạng / theo chất)'],
    ['Esc', 'Bỏ chọn tất cả'], ['N', 'Sẵn sàng / Bắt đầu ván mới (chủ phòng)'],
  ],
  xiangqi: [['Click', 'Chọn quân → chọn ô đích'], ['Esc', 'Bỏ chọn quân'], ['F', 'Lật bàn cờ']],
  samloc: [
    ['← / →', 'Di chuyển giữa các lá'], ['Space / ↑', 'Chọn lá đang trỏ'], ['↓', 'Bỏ chọn lá đang trỏ'],
    ['Enter', 'Đánh các lá đã chọn'], ['P', 'Bỏ lượt'], ['Esc', 'Bỏ chọn tất cả'],
    ['Y / K', 'Báo Sâm / Không báo (đầu ván)'], ['N', 'Sẵn sàng / Chia ván mới (chủ phòng)'],
  ],
  wordchain: [['Enter', 'Gửi từ'], ['Gõ', 'Khi tới lượt, ô nhập tự focus — chỉ cần gõ chữ thứ hai']],
  scribble: [
    ['Enter', 'Gửi câu đoán'], ['B / E / F', 'Bút / Tẩy / Đổ màu (khi đang vẽ)'], ['Z', 'Hoàn tác nét vừa vẽ'], ['1 – 5', 'Cỡ nét'],
  ],
  onet: [['Click', 'Chọn ô, rồi chọn ô cùng hình để nối'], ['H', 'Gợi ý'], ['S', 'Đổi hình (xáo bàn)'], ['Esc', 'Bỏ chọn']],
  telephone: [
    ['Enter', 'Nộp câu chữ'], ['B / E / F', 'Bút / Tẩy / Đổ màu (khi vẽ)'], ['Z', 'Hoàn tác'], ['1 – 5', 'Cỡ nét'],
    ['→ / Space', 'Lật phần tiếp theo khi xem lại (chủ phòng)'],
  ],
  quiz: [['1 / 2 / 3 / 4', 'Chọn đáp án ▲ ◆ ● ■'], ['Enter / →', 'Câu tiếp (khi đang xem đáp án)']],
  wordguess: [['Enter', 'Gửi từ đoán']],
  caro: [['Click', 'Đánh vào ô'], ['← ↑ → ↓', 'Di chuyển con trỏ trên bàn'], ['Enter / Space', 'Đánh vào ô có con trỏ'], ['Esc', 'Ẩn con trỏ']],
};

const WIDE = '(min-width: 1200px)';
const PANEL_TABS = [
  ['info', 'Thông tin', Info],
  ['chat', 'Trò chuyện', MessageCircle],
  ['people', 'Người chơi', Users],
];

export default function RoomView() {
  const { room, user, call, voiceStatus, toast } = useApp();
  const voice = useVoice({ room, me: user.id, status: voiceStatus, toast });
  const [help, setHelp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState(room.name);
  // Ngăn bên: màn rộng mở sẵn "Thông tin" cạnh bàn chơi; màn hẹp đóng, bấm nút mới hiện (đè lên bàn)
  const [panel, setPanel] = useState(() => (window.matchMedia?.(WIDE).matches ? 'info' : null));
  const [infoNode, setInfoNode] = useState(null);
  const Game = GAME_COMPONENT[room.game];
  const isOwner = room.ownerId === user.id;
  const me = room.members.find((m) => m.id === user.id);
  const turn = turnInfo(room, user.id);
  const unread = useUnread(room.chat, user.id, panel === 'chat');

  useHotkeys({
    '?': () => setHelp((h) => !h),
    Escape: () => !window.matchMedia?.(WIDE).matches && setPanel(null),
    // M: bật/tắt mic (chưa vào kênh thoại thì vào kênh)
    m: () => (voice.joined ? voice.toggleMute() : voice.available && voice.join()),
  });

  const togglePanel = useCallback((tab) => setPanel((p) => (p === tab ? null : tab)), []);
  const ui = useMemo(() => ({ infoNode, openPanel: setPanel }), [infoNode]);

  const leave = () => call('room:leave');
  const saveName = async (e) => {
    e.preventDefault();
    if (await call('room:rename', { name })) setEditing(false);
  };
  const [copied, setCopied] = useState(false);
  const copyLink = () => {
    navigator.clipboard?.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <RoomUICtx.Provider value={ui}>
      <div className={`room ${panel ? 'panel-open' : ''}`}>
        <div className="room-head">
          <button className="btn ghost room-back" onClick={leave} aria-label="Rời phòng"><ArrowLeft size={18} aria-hidden /><span className="hide-md">Rời phòng</span></button>
          <div className="room-title">
            <span className={`gicon g-${room.game}`}><GameIcon game={room.game} size={20} /></span>
            {editing ? (
              <form onSubmit={saveName} className="inline-form">
                <input autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn primary sm">Lưu</button>
                <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Hủy</button>
              </form>
            ) : (
              <div className="room-name">
                <h2 title={room.name}>
                  {room.name}
                  {me?.role === 'spectator' && <span className="badge watching"><Eye size={12} aria-hidden /> Đang xem</span>}
                </h2>
                <div className="room-sub-row">
                  <TurnPill info={turn} sub={`${GAME_META[room.game].name} · #${room.id}`} />
                  {room.state?.fair && <FairnessBadge roomId={room.id} fair={room.state.fair} />}
                </div>
              </div>
            )}
          </div>
          <div className="room-actions">
            <VoiceControl v={voice} onOpen={() => setPanel('people')} />
            {PANEL_TABS.map(([tab, label, Icon]) => (
              <button key={tab} className={`btn ghost sm rp-toggle ${tab === 'people' ? 'hide-sm' : ''} ${panel === tab ? 'on' : ''}`} onClick={() => togglePanel(tab)}
                aria-pressed={panel === tab} aria-label={tab === 'chat' && unread ? `${label} (${unread} tin mới)` : label} title={label}>
                <Icon size={18} aria-hidden /><span className="hide-xl">{label}</span>
                {tab === 'chat' && unread > 0 && <span className="unread" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
              </button>
            ))}
            <div className="menu-wrap">
              <button className="btn ghost sm" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Thêm" title="Thêm">
                <MoreVertical size={18} aria-hidden />
              </button>
              {menu && (
                <>
                  <div className="menu-scrim" onClick={() => setMenu(false)} />
                  <div className="menu" role="menu" onClick={() => setMenu(false)}>
                    <button role="menuitem" onClick={copyLink}><Link size={16} aria-hidden /> Sao chép link phòng</button>
                    <button role="menuitem" className="show-sm" onClick={() => setPanel('people')}><Users size={16} aria-hidden /> Người chơi{voice.available ? ' & kênh thoại' : ''}</button>
                    {voice.joined && <button role="menuitem" className="danger" onClick={voice.leave}><PhoneOff size={16} aria-hidden /> Rời kênh thoại</button>}
                    {isOwner && <button role="menuitem" onClick={() => { setName(room.name); setEditing(true); }}><Pencil size={16} aria-hidden /> Đổi tên phòng</button>}
                    <button role="menuitem" className="only-kbd" onClick={() => setHelp(true)}><Keyboard size={16} aria-hidden /> Phím tắt <kbd>?</kbd></button>
                    {isOwner && <button role="menuitem" className="danger" onClick={() => setConfirmDel(true)}><Trash2 size={16} aria-hidden /> Xóa phòng</button>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <TurnEffects info={turn} />
        <div className="room-body">
          <div className={`game-area ${turn?.mine ? 'my-turn' : ''}`}>
            <div className="game-fit">
              <Game room={room} state={room.state} />
            </div>
            {copied && <div className="room-flash" role="status"><Check size={14} aria-hidden /> Đã chép link phòng</div>}
          </div>
          {panel && <div className="rp-scrim" onClick={() => setPanel(null)} aria-hidden />}
          {/* Nằm trên cả ngăn bên (khi đang mở tab khác) để không bị che */}
          {panel !== 'chat' && <ChatPeek chat={room.chat} me={user.id} onOpen={() => setPanel('chat')} />}
          <aside className={`room-panel ${panel ? 'open' : ''}`} aria-label="Ngăn thông tin" inert={panel ? undefined : ''}>
            <div className="rp-tabs" role="tablist">
              {PANEL_TABS.map(([tab, label, Icon]) => (
                <button key={tab} role="tab" aria-selected={panel === tab} className={`rp-tab ${panel === tab ? 'active' : ''}`} onClick={() => setPanel(tab)} aria-label={label} title={label}>
                  <Icon size={16} aria-hidden /> <span className="rp-label">{label}</span>
                  {tab === 'chat' && unread > 0 && <span className="unread" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
                </button>
              ))}
              <button className="icon-btn rp-close" onClick={() => setPanel(null)} aria-label="Đóng ngăn"><X size={18} aria-hidden /></button>
            </div>
            <div className="rp-body">
              <div className="rp-pane rp-info" hidden={panel !== 'info'} ref={setInfoNode} />
              <div className="rp-pane" hidden={panel !== 'chat'}><Chat room={room} active={panel === 'chat'} /></div>
              <div className="rp-pane" hidden={panel !== 'people'}><Members room={room} isOwner={isOwner} voice={voice} /></div>
            </div>
          </aside>
        </div>
        {help && (
          <Modal title="Phím tắt" onClose={() => setHelp(false)}>
            <table className="keys">
              <tbody>
                {SHORTCUTS[room.game].map(([k, d]) => (
                  <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>
                ))}
                {voice.available && <tr><td><kbd>M</kbd></td><td>Bật / tắt mic (chưa vào kênh thoại thì vào kênh)</td></tr>}
                <tr><td><kbd>?</kbd></td><td>Mở / đóng bảng phím tắt</td></tr>
              </tbody>
            </table>
          </Modal>
        )}
        {confirmDel && (
          <ConfirmDialog title="Xóa phòng?" danger okLabel="Xóa phòng" icon={<Trash2 size={22} />}
            onOk={() => call('room:delete', { roomId: room.id })} onClose={() => setConfirmDel(false)}>
            Mọi người trong phòng sẽ bị đưa ra sảnh.
          </ConfirmDialog>
        )}
      </div>
    </RoomUICtx.Provider>
  );
}

/** Số tin nhắn mới (của người khác) từ lúc ngăn chat đóng. */
function useUnread(chat, me, open) {
  const seen = useRef(chat.length ? chat[chat.length - 1].id : null);
  const lastId = chat.length ? chat[chat.length - 1].id : null;
  useEffect(() => { if (open) seen.current = lastId; }, [open, lastId]);
  if (open) return 0;
  let n = 0;
  for (let i = chat.length - 1; i >= 0 && chat[i].id !== seen.current; i--) {
    if (!chat[i].system && chat[i].from !== me) n++;
  }
  return n;
}

/** Tin nhắn mới hiện thoáng qua ở góc bàn chơi khi ngăn chat đang đóng; bấm vào để mở chat. */
function ChatPeek({ chat, me, onOpen }) {
  const [msg, setMsg] = useState(null);
  const last = chat[chat.length - 1];
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (!last || last.system || last.from === me) return undefined;
    setMsg(last);
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!msg) return null;
  return (
    <button className="chat-peek" onClick={() => { setMsg(null); onOpen(); }} aria-label={`Tin nhắn mới từ ${msg.name}: ${msg.text}. Bấm để mở trò chuyện`}>
      <MessageCircle size={16} aria-hidden />
      <span className="cp-text"><b>{msg.name}:</b> {msg.text}</span>
    </button>
  );
}

function Members({ room, isOwner, voice }) {
  const { user, call } = useApp();
  const inVoice = new Map(voice.members.map((v) => [v.id, v]));
  const players = room.members.filter((m) => m.role === 'player');
  const watchers = room.members.filter((m) => m.role === 'spectator');
  const [kick, setKick] = useState(null);
  const row = (m) => (
    <li key={m.id} className={m.online ? '' : 'offline'}>
      <span className={`dot ${m.online ? 'on' : 'off'}`} />
      {m.name}
      {inVoice.has(m.id) && (inVoice.get(m.id).muted
        ? <MicOff size={13} className="mem-mic off" aria-label="Trong kênh thoại, đang tắt mic" />
        : <Mic size={13} className={`mem-mic ${voice.speaking.has(m.id) ? 'talk' : ''}`} aria-label="Trong kênh thoại" />)}
      {m.id === room.ownerId && <Crown size={14} className="owner-crown" aria-label="Chủ phòng" />}
      {m.id === user.id && <span className="muted"> (bạn)</span>}
      {isOwner && m.id !== user.id && (
        <button className="link danger" onClick={() => setKick(m)}>mời ra</button>
      )}
    </li>
  );
  return (
    <div className="members">
      <VoicePanel v={voice} room={room} me={user.id} />
      <h4>Người chơi ({players.length})</h4>
      <ul>{players.map(row)}</ul>
      <h4>Người xem ({watchers.length})</h4>
      <ul>{watchers.length ? watchers.map(row) : <li className="muted">—</li>}</ul>
      {kick && (
        <ConfirmDialog title="Mời ra khỏi phòng?" danger okLabel="Mời ra" onOk={() => call('room:kick', { userId: kick.id })} onClose={() => setKick(null)}>
          <b>{kick.name}</b> sẽ bị đưa ra sảnh.
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * Nút thoại ở đầu phòng — gọn một chỗ:
 *  - Chưa vào: tai nghe "Vào thoại" (+ số người đang trong kênh)
 *  - Đã vào: nút micro bật/tắt (viền xanh khi mình đang nói) + nút rời (màn rộng; điện thoại rời trong menu ⋮ / tab Người chơi)
 */
function VoiceControl({ v, onOpen }) {
  if (!v.available && !v.joined) return null;
  const n = v.members.length;
  if (!v.joined) {
    return (
      <button className={`btn ghost sm voice-btn ${n ? 'live' : ''}`} onClick={v.join} disabled={v.joining}
        title={n ? `Vào kênh thoại (${n} người đang nói chuyện) — phím M` : 'Vào kênh thoại — phím M'} aria-label={n ? `Vào kênh thoại, ${n} người đang trong kênh` : 'Vào kênh thoại'}>
        <Headphones size={18} aria-hidden /><span className="hide-xl">{v.joining ? 'Đang vào…' : 'Thoại'}</span>
        {n > 0 && <span className="unread voice" aria-hidden>{n}</span>}
      </button>
    );
  }
  const othersTalking = [...v.speaking].some((id) => id !== v.me);
  return (
    <div className="voice-ctl" role="group" aria-label="Kênh thoại">
      <button className={`btn sm voice-mic ${v.muted ? 'muted' : 'on'} ${v.speaking.has(v.me) ? 'talk' : ''} ${othersTalking ? 'others' : ''}`}
        onClick={v.toggleMute} disabled={v.joining} aria-pressed={!v.muted}
        title={!v.micOk ? 'Thử lại micro' : v.muted ? 'Bật mic (M)' : 'Tắt mic (M)'} aria-label={!v.micOk ? 'Thử lại micro' : v.muted ? 'Bật mic' : 'Tắt mic'}>
        {v.muted ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
        <span className="voice-count" aria-hidden>{n}</span>
      </button>
      <button className="btn sm ghost voice-leave hide-sm" onClick={v.leave} title="Rời kênh thoại" aria-label="Rời kênh thoại"><PhoneOff size={16} aria-hidden /></button>
    </div>
  );
}

/** Khối kênh thoại trong tab Người chơi: vào/rời, bật/tắt mic, ai đang nói, chỉnh âm lượng từng người. */
function VoicePanel({ v, room, me }) {
  if (!v.status || v.status.hidden) return null; // server (sảnh) này không bật voice chat
  const nameOf = (id) => room.members.find((m) => m.id === id)?.name || '?';
  return (
    <section className="voice-card" aria-label="Kênh thoại">
      <div className="vc-head">
        <Headphones size={16} aria-hidden /> <b>Kênh thoại</b>
        {v.available && <span className="muted small">{v.members.length}/{v.status.maxPerRoom}</span>}
      </div>
      {!v.available && !v.joined ? (
        <div className="muted small">{v.status.reason || 'Voice chat đang tắt'}</div>
      ) : !v.joined ? (
        <>
          <button className="btn cta vc-join" onClick={v.join} disabled={v.joining}><Headphones size={16} aria-hidden /> {v.joining ? 'Đang vào…' : 'Vào kênh thoại'}</button>
          <div className="muted small">Âm thanh đi thẳng giữa các máy, không ghi âm. Trình duyệt sẽ hỏi quyền dùng micro.</div>
        </>
      ) : (
        <div className="row vc-actions">
          {v.micOk
            ? <button className={`btn ${v.muted ? '' : 'primary'}`} onClick={v.toggleMute}>{v.muted ? <><MicOff size={16} aria-hidden /> Bật mic</> : <><Mic size={16} aria-hidden /> Tắt mic</>} <kbd>M</kbd></button>
            : <button className="btn" onClick={v.toggleMute} disabled={v.joining}><MicOff size={16} aria-hidden /> {v.joining ? 'Đang bật micro…' : 'Thử lại micro'}</button>}
          <button className="btn danger" onClick={v.leave}><PhoneOff size={16} aria-hidden /> Rời kênh</button>
        </div>
      )}
      {v.members.length > 0 && (
        <ul className="vc-list">
          {v.members.map((m) => {
            const st = m.id === me ? null : v.peerState[m.id];
            return (
              <li key={m.id} className={v.speaking.has(m.id) ? 'talk' : ''}>
                <span className="vc-avatar" aria-hidden>{nameOf(m.id).trim()[0]?.toUpperCase()}</span>
                <span className="vc-name">{nameOf(m.id)}{m.id === me && <span className="muted"> (bạn)</span>}</span>
                {st && st !== 'connected' && v.joined && <span className="muted small">{st === 'failed' ? 'không kết nối được' : 'đang kết nối…'}</span>}
                {m.muted ? <MicOff size={14} className="mem-mic off" aria-label="Tắt mic" /> : <Mic size={14} className={`mem-mic ${v.speaking.has(m.id) ? 'talk' : ''}`} aria-label="Bật mic" />}
                {v.joined && m.id !== me && (
                  <label className="vc-vol" title="Âm lượng">
                    <Volume2 size={14} aria-hidden />
                    <input type="range" min="0" max="1" step="0.05" value={v.volumes[m.id] ?? 1} aria-label={`Âm lượng của ${nameOf(m.id)}`}
                      onChange={(e) => v.setVolume(m.id, Number(e.target.value))} />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Chat({ room, active }) {
  const { call, user } = useApp();
  const [text, setText] = useState('');
  const box = useRef(null);
  const input = useRef(null);
  const last = room.chat[room.chat.length - 1];
  // Luôn cuộn tới tin mới nhất: khi mở ngăn chat, khi có tin mới (sau khi vẽ xong để đo đúng chiều cao)
  useLayoutEffect(() => {
    const el = box.current;
    if (el && active) el.scrollTop = el.scrollHeight;
  }, [active, last?.id]);
  useEffect(() => {
    if (active && window.matchMedia?.('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, [active]);
  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    call('room:chat', { text });
    setText('');
  };
  return (
    <div className="chat">
      <div className="chat-box" ref={box}>
        {room.chat.length === 0 && <div className="muted small chat-empty">Chưa có tin nhắn nào</div>}
        {room.chat.map((m) => (
          <div key={m.id} className={m.system ? 'sys' : m.from === user.id ? 'msg mine' : 'msg'}>
            {m.system ? m.text : <><b>{m.name}:</b> {m.text}</>}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="chat-form">
        <input ref={input} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Nhập tin nhắn… (Enter)" />
      </form>
    </div>
  );
}
