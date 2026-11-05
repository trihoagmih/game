import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store.jsx';
import { ArrowLeft, Pencil, Link, Keyboard, Trash2, Eye, Check } from 'lucide-react';
import { GAME_META, GameIcon } from './Lobby.jsx';
import Modal from './Modal.jsx';
import XiangqiGame from '../games/XiangqiGame.jsx';
import PokerGame from '../games/PokerGame.jsx';
import TalaGame from '../games/TalaGame.jsx';
import CaroGame from '../games/CaroGame.jsx';
import SamLocGame from '../games/SamLocGame.jsx';
import WordChainGame from '../games/WordChainGame.jsx';
import { useHotkeys } from '../hooks.js';

const GAME_COMPONENT = { xiangqi: XiangqiGame, poker: PokerGame, tala: TalaGame, caro: CaroGame, samloc: SamLocGame, wordchain: WordChainGame };

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
    ['Esc', 'Bỏ chọn tất cả'], ['N', 'Bắt đầu ván mới'],
  ],
  xiangqi: [['Click', 'Chọn quân → chọn ô đích'], ['Esc', 'Bỏ chọn quân'], ['F', 'Lật bàn cờ']],
  samloc: [
    ['← / →', 'Di chuyển giữa các lá'], ['Space / ↑', 'Chọn lá đang trỏ'], ['↓', 'Bỏ chọn lá đang trỏ'],
    ['Enter', 'Đánh các lá đã chọn'], ['P', 'Bỏ lượt'], ['Esc', 'Bỏ chọn tất cả'],
    ['Y / K', 'Báo Sâm / Không báo (đầu ván)'], ['N', 'Chia ván mới'],
  ],
  wordchain: [['Enter', 'Gửi từ'], ['Gõ', 'Khi tới lượt, ô nhập tự focus — chỉ cần gõ chữ thứ hai']],
  caro: [['Click', 'Đánh vào ô'], ['← ↑ → ↓', 'Di chuyển con trỏ trên bàn'], ['Enter / Space', 'Đánh vào ô có con trỏ'], ['Esc', 'Ẩn con trỏ']],
};

export default function RoomView() {
  const { room, user, call } = useApp();
  const [help, setHelp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  const Game = GAME_COMPONENT[room.game];
  const isOwner = room.ownerId === user.id;
  const me = room.members.find((m) => m.id === user.id);

  useHotkeys({ '?': () => setHelp((h) => !h) });

  const leave = () => call('room:leave');
  const del = () => confirm('Xóa phòng này? Mọi người sẽ bị đưa ra sảnh.') && call('room:delete', { roomId: room.id });
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
    <div className="room">
      <div className="room-head">
        <button className="btn ghost room-back" onClick={leave} aria-label="Rời phòng"><ArrowLeft size={18} aria-hidden /><span className="hide-sm">Rời phòng</span></button>
        <div className="room-title">
          <span className={`gicon g-${room.game}`}><GameIcon game={room.game} size={20} /></span>
          {editing ? (
            <form onSubmit={saveName} className="inline-form">
              <input autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn primary sm">Lưu</button>
              <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Hủy</button>
            </form>
          ) : (
            <>
              <div className="room-name">
                <h2 title={room.name}>{room.name}</h2>
                <span className="muted small room-sub">{GAME_META[room.game].name} · #{room.id}</span>
              </div>
              {isOwner && <button className="icon-btn" title="Đổi tên phòng" aria-label="Đổi tên phòng" onClick={() => { setName(room.name); setEditing(true); }}><Pencil size={16} aria-hidden /></button>}
            </>
          )}
          {me?.role === 'spectator' && <span className="badge watching"><Eye size={12} aria-hidden />&nbsp;Đang xem</span>}
        </div>
        <div className="room-actions">
          <button className="btn ghost sm" onClick={copyLink} title="Sao chép link phòng" aria-label="Sao chép link phòng">
            {copied ? <Check size={16} aria-hidden /> : <Link size={16} aria-hidden />}<span className="hide-sm">{copied ? 'Đã chép' : 'Link'}</span>
          </button>
          <button className="btn ghost sm only-kbd" onClick={() => setHelp(true)} title="Phím tắt (?)" aria-label="Phím tắt"><Keyboard size={16} aria-hidden /><span className="hide-sm">Phím tắt</span></button>
          {isOwner && <button className="btn danger sm" onClick={del} aria-label="Xóa phòng"><Trash2 size={16} aria-hidden /><span className="hide-sm">Xóa phòng</span></button>}
        </div>
      </div>
      <div className="room-body">
        <div className="game-area">
          <Game room={room} state={room.state} />
        </div>
        <aside className="sidebar">
          <Members room={room} isOwner={isOwner} />
          <Chat room={room} />
        </aside>
      </div>
      {help && (
        <Modal title="Phím tắt" onClose={() => setHelp(false)}>
          <table className="keys">
            <tbody>
              {SHORTCUTS[room.game].map(([k, d]) => (
                <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>
              ))}
              <tr><td><kbd>?</kbd></td><td>Mở / đóng bảng phím tắt</td></tr>
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function Members({ room, isOwner }) {
  const { user, call } = useApp();
  const players = room.members.filter((m) => m.role === 'player');
  const watchers = room.members.filter((m) => m.role === 'spectator');
  const row = (m) => (
    <li key={m.id} className={m.online ? '' : 'offline'}>
      <span className={`dot ${m.online ? 'on' : 'off'}`} />
      {m.name}
      {m.id === room.ownerId && <span title="Chủ phòng"> 👑</span>}
      {m.id === user.id && <span className="muted"> (bạn)</span>}
      {isOwner && m.id !== user.id && (
        <button className="link danger" onClick={() => confirm(`Mời ${m.name} ra khỏi phòng?`) && call('room:kick', { userId: m.id })}>mời ra</button>
      )}
    </li>
  );
  return (
    <div className="panel members">
      <h4>Người chơi ({players.length})</h4>
      <ul>{players.map(row)}</ul>
      <h4>Người xem ({watchers.length})</h4>
      <ul>{watchers.length ? watchers.map(row) : <li className="muted">—</li>}</ul>
    </div>
  );
}

function Chat({ room }) {
  const { call } = useApp();
  const [text, setText] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [room.chat.length]);
  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    call('room:chat', { text });
    setText('');
  };
  return (
    <div className="panel chat">
      <h4>Trò chuyện</h4>
      <div className="chat-box" ref={box}>
        {room.chat.map((m) => (
          <div key={m.id} className={m.system ? 'sys' : 'msg'}>
            {m.system ? m.text : <><b>{m.name}:</b> {m.text}</>}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="chat-form">
        <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Nhập tin nhắn… (Enter)" />
      </form>
    </div>
  );
}
