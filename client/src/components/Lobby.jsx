import { useState } from 'react';
import { Layers, Club, Spade, Castle, Grid3x3, WholeWord, Plus, Eye, Trash2, Search, Users } from 'lucide-react';
import { useApp } from '../store.jsx';
import CreateRoomDialog from './CreateRoomDialog.jsx';

export const GAME_META = {
  tala: { name: 'Tá lả', Icon: Layers, desc: 'Phỏm 2–4 người, ăn – hạ – gửi – Ù' },
  samloc: { name: 'Sâm lốc', Icon: Club, desc: '2–5 người, 10 lá, báo Sâm – chặt heo' },
  poker: { name: 'Poker', Icon: Spade, desc: "Texas Hold'em No-Limit, 2–9 người" },
  xiangqi: { name: 'Cờ tướng', Icon: Castle, desc: '2 người, mỗi bên 8 phút, có chế độ xem' },
  caro: { name: 'Cờ caro', Icon: Grid3x3, desc: '2 người, 5 quân liên tiếp là thắng' },
  wordchain: { name: 'Nối từ', Icon: WholeWord, desc: '2–8 người, nối từ tiếng Việt theo lượt' },
};

/** Icon SVG của trò chơi (bộ Lucide), màu theo từng trò. */
export function GameIcon({ game, size = 24 }) {
  const I = GAME_META[game]?.Icon || Layers;
  return <I size={size} strokeWidth={2} aria-hidden />;
}

export default function Lobby() {
  const { rooms, user, call } = useApp();
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(null);
  const [q, setQ] = useState('');

  const count = (k) => rooms.filter((r) => r.game === k).length;
  const list = rooms.filter((r) => (filter === 'all' || r.game === filter) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="lobby">
      <section>
        <div className="section-head">
          <div>
            <h2>Chọn trò chơi</h2>
            <p className="muted">Tạo bàn mới hoặc vào một phòng đang mở bên dưới.</p>
          </div>
        </div>
        <div className="game-cards">
          {Object.entries(GAME_META).map(([k, g]) => (
            <div key={k} className={`game-card g-${k}`}>
              <div className="gc-top">
                <div className="gc-icon"><GameIcon game={k} size={26} /></div>
                <div>
                  <h3>{g.name}</h3>
                  <div className="gc-count"><b>{count(k)}</b> phòng đang mở</div>
                </div>
              </div>
              <p className="gc-desc">{g.desc}</p>
              <button className="btn primary block" onClick={() => setCreating(k)}><Plus size={18} aria-hidden /> Tạo bàn</button>
            </div>
          ))}
        </div>
      </section>

      <section className="room-list">
        <div className="section-head">
          <div>
            <h2>Phòng đang mở</h2>
            <p className="muted">{rooms.length ? `${rooms.length} phòng · cập nhật trực tiếp` : 'Chưa có phòng nào'}</p>
          </div>
        </div>
        <div className="room-list-head">
          <div className="tabs" role="tablist">
            {[['all', 'Tất cả', rooms.length], ...Object.entries(GAME_META).map(([k, g]) => [k, g.name, count(k)])].map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={`tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                {label} <span className="tab-count">{n}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={16} aria-hidden />
            <input type="search" placeholder="Tìm phòng…" aria-label="Tìm phòng" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>

        {list.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><Users size={34} aria-hidden /></div>
            <b>{q || filter !== 'all' ? 'Không có phòng phù hợp' : 'Chưa có phòng nào'}</b>
            <span>Hãy tạo bàn mới và mời bạn bè vào chơi.</span>
          </div>
        ) : (
          <div className="rooms">
            {list.map((r) => {
              const full = r.players >= r.maxPlayers;
              return (
                <div key={r.id} className="room-item">
                  <div className={`ri-icon g-${r.game}`}><GameIcon game={r.game} size={22} /></div>
                  <div className="ri-body">
                    <div className="ri-title">
                      <b title={r.name}>{r.name}</b>
                      <span className={`badge ${r.playing ? 'playing' : 'waiting'}`}>{r.playing ? 'Đang chơi' : 'Đang chờ'}</span>
                    </div>
                    <div className="muted small ri-meta" title={describeOptions(r)}>
                      {r.gameName} · {r.ownerName} · {describeOptions(r)}
                    </div>
                    <div className="ri-seats">
                      <div className="seat-bar"><div style={{ width: `${Math.min(100, (r.players / r.maxPlayers) * 100)}%` }} /></div>
                      <span>{r.players}/{r.maxPlayers}</span>
                      {r.playerNames.length > 0 && <span className="muted ri-meta">{r.playerNames.join(', ')}</span>}
                      {r.spectators > 0 && <span className="muted ri-watch"><Eye size={13} aria-hidden /> {r.spectators}</span>}
                    </div>
                  </div>
                  <div className="ri-actions">
                    <button className="btn primary" disabled={full} onClick={() => call('room:join', { roomId: r.id, mode: 'play' })}>
                      {full ? 'Đủ người' : 'Vào chơi'}
                    </button>
                    <button className="btn" onClick={() => call('room:join', { roomId: r.id, mode: 'watch' })} title="Vào xem" aria-label={`Vào xem phòng ${r.name}`}><Eye size={18} aria-hidden /><span className="hide-lg">Xem</span></button>
                    {r.ownerId === user.id && (
                      <button className="btn danger" title="Xóa phòng" aria-label={`Xóa phòng ${r.name}`} onClick={() => confirm(`Xóa phòng "${r.name}"?`) && call('room:delete', { roomId: r.id })}><Trash2 size={18} aria-hidden /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {creating && <CreateRoomDialog game={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function describeOptions(r) {
  const o = r.options || {};
  if (r.game === 'xiangqi') return `${o.minutes} phút/bên`;
  if (r.game === 'caro') return `${o.size}×${o.size} · ${o.minutes} phút/bên${o.blockTwoEnds ? ' · chặn 2 đầu' : ''}`;
  if (r.game === 'wordchain') return `${o.turnSeconds} giây/lượt · ${o.lives} mạng${o.dictionary ? ' · có từ điển' : ''}`;
  if (r.game === 'poker') return `Blind ${o.smallBlind}/${o.bigBlind} · Buy-in ${o.buyIn}`;
  if (r.game === 'samloc') return `Cược ${o.unit}/đơn vị · ${o.turnSeconds} giây/lượt`;
  if (r.game === 'tala') return `Cược ${o.unit}/đơn vị`;
  return '';
}
