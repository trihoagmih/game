import { useEffect, useRef, useState } from 'react';
import { Layers, Club, Spade, Castle, Crown, Grid3x3, WholeWord, Palette, MessagesSquare, PawPrint, Worm, Plus, Eye, Trash2, Search, Users, LogIn, ChevronDown, ChevronLeft, ChevronRight, Lightbulb, SpellCheck, Blocks, Bird, Pickaxe, Mic } from 'lucide-react';
import { useApp } from '../store.js';
import CreateRoomDialog from './CreateRoomDialog.js';
import type { LucideIcon } from 'lucide-react';
import type { OnlineUser, RoomSummary } from '@game/shared/contracts';
import './Lobby.css';

const DIFFICULTY_NAMES: Record<string, string> = { mix: 'Tăng dần', easy: 'Nhẹ nhàng', hard: 'Hiểm hóc' };
const SNAKE_MAZE: Record<string, string> = { none: 'Không tường', box: 'Hộp kín', tunnel: 'Đường hầm', rooms: 'Bốn phòng', rails: 'Đường ray' };

export const GAME_META: Record<string, { name: string; Icon: LucideIcon; desc: string }> = {
  chess: { name: 'Cờ vua', Icon: Crown, desc: '2 người, chuẩn FIDE, phong cấp, nhập thành, bắt qua đường' },
  tala: { name: 'Tá lả', Icon: Layers, desc: 'Phỏm 2–4 người, ăn – hạ – gửi – Ù' },
  samloc: { name: 'Sâm lốc', Icon: Club, desc: '2–5 người, 10 lá, báo Sâm – chặt heo' },
  poker: { name: 'Poker', Icon: Spade, desc: "Texas Hold'em No-Limit, 2–9 người" },
  xiangqi: { name: 'Cờ tướng', Icon: Castle, desc: '2 người, mỗi bên 8 phút, có chế độ xem' },
  caro: { name: 'Cờ caro', Icon: Grid3x3, desc: '2 người, 5 quân liên tiếp là thắng' },
  wordchain: { name: 'Nối từ', Icon: WholeWord, desc: '2–8 người, nối từ tiếng Việt theo lượt' },
  scribble: { name: 'Vẽ đoán', Icon: Palette, desc: '2–12 người, một người vẽ, cả bàn đoán chữ' },
  twister: { name: 'Líu lưỡi', Icon: Mic, desc: '2–12 người chia 2 đội, lần lượt đọc to câu líu lưỡi, cả bàn chấm chuẩn hay vấp' },
  telephone: { name: 'Tam sao thất bản', Icon: MessagesSquare, desc: '3–12 người, viết → vẽ → đoán → vẽ… rồi xem câu chuyện thất bản' },
  onet: { name: 'Nối thú', Icon: PawPrint, desc: '1–8 người, nối cặp thú giống nhau, đua dọn sạch bàn' },
  tetris: { name: 'Tetris', Icon: Blocks, desc: 'Đấu 1v1, ai xóa đủ số hàng mục tiêu trước sẽ thắng' },
  chicken: { name: 'Bắn gà', Icon: Bird, desc: '1–8 người, phi thuyền bắn gà, né trứng, 3 mạng và đua điểm arcade' },
  skyhop: { name: 'Bay qua khe', Icon: Bird, desc: '1–8 người, chạm để nảy qua khe cột, sinh tồn, khe hẹp dần để thử phá kỷ lục' },
  goldmine: { name: 'Đào vàng', Icon: Pickaxe, desc: '1–8 người cùng bản đồ, phóng móc gắp vàng, đạt mục tiêu từng màn' },
  snake: { name: 'Rắn săn mồi', Icon: Worm, desc: 'Rắn cổ điển màn hình LCD, 1–8 người đua điểm, 9 cấp tốc độ, mê cung' },
  quiz: { name: 'Đố vui', Icon: Lightbulb, desc: 'Kiểu Kahoot, 1–30 người, có bộ câu hỏi sẵn hoặc tự soạn' },
  wordguess: { name: 'Đoán chữ', Icon: SpellCheck, desc: 'Đoán từ 2 chữ trong 6 lượt, đua hoặc cùng đoán' },
};

// Nhóm trò để lọc nhanh khi danh sách game dài
export const GAME_GROUPS: [string, string, string[]?][] = [
  ['all', 'Tất cả'],
  ['cards', 'Bài lá', ['tala', 'samloc', 'poker']],
  ['board', 'Cờ', ['chess', 'xiangqi', 'caro']],
  ['words', 'Chữ & đố', ['wordchain', 'quiz', 'wordguess']],
  ['party', 'Vẽ & nhóm', ['scribble', 'telephone', 'twister']],
  ['arcade', 'Giải trí', ['onet', 'snake', 'tetris', 'skyhop', 'goldmine', 'chicken']],
];
const GROUP_KEY = 'gl_lobby_group';
const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** Icon SVG của trò chơi (bộ Lucide), màu theo từng trò. */
export function GameIcon({ game, size = 24 }: { game: string; size?: number }) {
  const I = GAME_META[game]?.Icon || Layers;
  return <I size={size} strokeWidth={2} aria-hidden />;
}

/**
 * Chọn trò chơi: lọc theo nhóm + tìm tên, các thẻ xếp thành một hàng trượt ngang (vuốt trên điện thoại,
 * nút ‹ › trên máy tính). Bấm cả thẻ để tạo bàn.
 */
function GamePicker({ count, onCreate }: {count: (game: string) => number; onCreate: (game: string) => void}) {
  const [group, setGroup] = useState(() => { try { return localStorage.getItem(GROUP_KEY) || 'all'; } catch { return 'all'; } });
  const [q, setQ] = useState('');
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const pick = (g: string) => {
    setGroup(g);
    try { localStorage.setItem(GROUP_KEY, g); } catch { /* bỏ qua */ }
    track.current?.scrollTo({ left: 0 });
  };
  const inGroup = GAME_GROUPS.find(([k]) => k === group)?.[2];
  const games = Object.entries(GAME_META).filter(([k, g]) => (!inGroup || inGroup.includes(k))
    && (!q || fold(`${g.name} ${g.desc}`).includes(fold(q))));

  const measure = () => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [games.length]);
  const slide = (dir: number) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <>
      <div className="section-head">
        <div>
          <h2>Chọn trò chơi</h2>
          <p className="muted">{Object.keys(GAME_META).length} trò · bấm vào thẻ để tạo bàn, hoặc vào một phòng đang mở bên dưới.</p>
        </div>
        <label className="search gp-search">
          <Search size={16} aria-hidden />
          <input type="search" placeholder="Tìm trò chơi…" aria-label="Tìm trò chơi" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="gp-groups" role="tablist" aria-label="Nhóm trò chơi">
        {GAME_GROUPS.map(([k, label, list]) => (
          <button key={k} role="tab" aria-selected={group === k} className={`gp-chip ${group === k ? 'active' : ''}`} onClick={() => pick(k)}>
            {label} <span className="tab-count">{list ? list.length : Object.keys(GAME_META).length}</span>
          </button>
        ))}
      </div>
      <div className="gp-slider">
        {!edge.start && <button className="gp-arrow prev" onClick={() => slide(-1)} aria-label="Xem các trò trước"><ChevronLeft size={22} /></button>}
        <div className="gp-track" ref={track} onScroll={measure}>
          {games.map(([k, g]) => (
            <button key={k} type="button" className={`game-card g-${k}`} onClick={() => onCreate(k)} aria-label={`Tạo bàn ${g.name}`}>
              <div className="gc-top">
                <div className="gc-icon"><GameIcon game={k} size={24} /></div>
                <div className="gc-head">
                  <h3>{g.name}</h3>
                  <div className="gc-count">{count(k) ? <><b>{count(k)}</b> phòng đang mở</> : 'Chưa có phòng'}</div>
                </div>
              </div>
              <p className="gc-desc">{g.desc}</p>
              <span className="gc-cta"><Plus size={16} aria-hidden /> Tạo bàn</span>
            </button>
          ))}
          {games.length === 0 && <div className="gp-empty muted">Không có trò nào khớp “{q}”</div>}
        </div>
        {!edge.end && <button className="gp-arrow next" onClick={() => slide(1)} aria-label="Xem các trò tiếp"><ChevronRight size={22} /></button>}
      </div>
    </>
  );
}

export default function Lobby() {
  const { rooms, user, call } = useApp();
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const count = (k: string) => rooms.filter((r) => r.game === k).length;
  const list = rooms.filter((r) => (filter === 'all' || r.game === filter) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="lobby">
      <section className="lobby-games">
        <GamePicker count={count} onCreate={setCreating} />
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
            {[['all', 'Tất cả', rooms.length] as const, ...Object.entries(GAME_META).filter(([k]) => count(k) > 0 || filter === k).map(([k, g]) => [k, g.name, count(k)] as const)].map(([k, label, n]) => (
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
                    {r.ownerId === user?.id && (
                      <button className="btn danger" title="Xóa phòng" aria-label={`Xóa phòng ${r.name}`} onClick={() => confirm(`Xóa phòng "${r.name}"?`) && call('room:delete', { roomId: r.id })}><Trash2 size={18} aria-hidden /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <OnlinePanel />
      {creating && <CreateRoomDialog game={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

/** Màu avatar cố định theo id để dễ phân biệt từng người. */
const hueOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

function Avatar({ p, size = 34 }: { p: OnlineUser; size?: number }) {
  return (
    <span className="op-avatar" aria-hidden style={{ '--h': hueOf(p.id), width: size, height: size }}>{initial(p.name)}</span>
  );
}

/**
 * Người đang online cùng server (trừ mình), chia hai nhóm: ở sảnh (dễ rủ chơi) và đang trong phòng (bấm để vào cùng).
 * Trên điện thoại khung thu gọn thành một dòng avatar, chạm để mở.
 */
const OPEN_KEY = 'gl_online_open';

function OnlinePanel() {
  const { online, user, call } = useApp();
  const [q, setQ] = useState('');
  // Ẩn / hiện danh sách, nhớ lựa chọn trên trình duyệt. Lần đầu: màn rộng mở sẵn, màn hẹp thu gọn.
  const [open, setOpenState] = useState(() => {
    try {
      const v = localStorage.getItem(OPEN_KEY);
      if (v !== null) return v === '1';
    } catch { /* không có localStorage */ }
    return !!window.matchMedia?.('(min-width: 1100px)').matches;
  });
  const setOpen = (f: (open: boolean) => boolean) => setOpenState((v) => {
    const next = f(v);
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* bỏ qua */ }
    return next;
  });
  const others = online.filter((p) => p.id !== user?.id);
  const match = (p: OnlineUser) => !q || p.name.toLowerCase().includes(q.toLowerCase());
  const byName = (a: OnlineUser, b: OnlineUser) => a.name.localeCompare(b.name, 'vi');
  const idle = others.filter((p) => !p.room && match(p)).sort(byName);
  const busy = others.filter((p) => p.room && match(p))
    .sort((a, b) => Number(!!b.room?.playing) - Number(!!a.room?.playing) || byName(a, b));

  const row = (p: OnlineUser) => {
    const r = p.room;
    return (
      <li key={p.id}>
        <Avatar p={p} />
        <div className="op-body">
          <b title={p.name}>{p.name}</b>
          {r ? (
            <span className={`op-status g-${r.game}`} title={`${GAME_META[r.game]?.name} · ${r.name}`}>
              <GameIcon game={r.game} size={13} />
              <span className="op-room">{r.playing ? 'Chơi' : 'Xem'} · {r.name}</span>
            </span>
          ) : <span className="op-status">Đang rảnh</span>}
        </div>
        {r && (
          <button className="btn sm op-join" title={`Vào phòng ${r.name}`} aria-label={`Vào phòng ${r.name} cùng ${p.name}`}
            onClick={() => call('room:join', { roomId: r.id, mode: r.playing ? 'play' : 'watch' })}>
            <LogIn size={15} aria-hidden /> Vào
          </button>
        )}
      </li>
    );
  };

  return (
    <aside className={`online-panel ${open ? 'open' : ''}`} aria-labelledby="online-title">
      <button type="button" className="op-head" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="online-content"
        title={open ? 'Ẩn danh sách' : 'Hiện danh sách người đang online'}>
        <h2 id="online-title"><span className="dot on" aria-hidden />Đang online</h2>
        <span className="op-stack" aria-hidden>
          {others.slice(0, 4).map((p) => <Avatar key={p.id} p={p} size={24} />)}
          {others.length > 4 && <span className="op-more">+{others.length - 4}</span>}
        </span>
        <span className="tab-count" aria-label={`${others.length} người khác`}>{others.length}</span>
        <ChevronDown size={18} className="op-chevron" aria-hidden />
      </button>
      <div className="op-content" id="online-content">
        {others.length === 0 ? (
          <div className="op-empty">
            <Users size={26} aria-hidden />
            <span>Chỉ có bạn đang online.<br />Gửi link cho bạn bè để cùng chơi nhé!</span>
          </div>
        ) : (
          <>
            {others.length > 6 && (
              <label className="search">
                <Search size={16} aria-hidden />
                <input type="search" placeholder="Tìm người chơi…" aria-label="Tìm người chơi" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            )}
            <div className="op-scroll">
              {idle.length > 0 && <>
                <h3 className="op-group">Ở sảnh <span>{idle.length}</span></h3>
                <ul className="op-list">{idle.map(row)}</ul>
              </>}
              {busy.length > 0 && <>
                <h3 className="op-group">Trong phòng <span>{busy.length}</span></h3>
                <ul className="op-list">{busy.map(row)}</ul>
              </>}
              {!idle.length && !busy.length && <p className="muted small">Không tìm thấy ai</p>}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function describeOptions(r: RoomSummary) {
  const o = r.options || {};
  if (r.game === 'xiangqi') return `${o.minutes} phút/bên`;
  if (r.game === 'caro') return `${o.size}×${o.size} · ${o.minutes} phút/bên${o.blockTwoEnds ? ' · chặn 2 đầu' : ''}`;
  if (r.game === 'wordchain') return `${o.turnSeconds} giây/lượt · ${o.lives} mạng${o.dictionary ? (o.strict ? ' · từ điển chặt' : ' · từ điển thoáng') : ''}`;
  if (r.game === 'quiz') return `${o.category === 'all' ? 'Tất cả chủ đề' : o.category} · ${o.questions} câu · ${o.seconds} giây/câu`;
  if (r.game === 'wordguess') return `${o.mode === 'coop' ? 'Cùng đoán' : 'Đua'}${o.daily ? ' · Từ của ngày' : ''} · ${o.minutes} phút`;
  if (r.game === 'poker') return `Blind ${o.smallBlind}/${o.bigBlind} · Buy-in ${o.buyIn}`;
  if (r.game === 'samloc') return `Cược ${o.unit}/đơn vị · ${o.turnSeconds} giây/lượt`;
  if (r.game === 'tala') return `Cược ${o.unit}/đơn vị`;
  if (r.game === 'twister') return `${DIFFICULTY_NAMES[String(o.difficulty)] ?? ''} · ${o.rounds} câu/người · ${o.readSeconds} giây`;
  if (r.game === 'tetris') return `Đua xóa ${o.targetLines} hàng`;
  if (r.game === 'chicken') return `${['Dễ', 'Vừa', 'Khó'][Number(o.level) - 1] ?? 'Dễ'} · 3 mạng · 5 phút`;
  if (r.game === 'skyhop') return `${['Dễ', 'Vừa', 'Khó'][Number(o.level) - 1] ?? ''} · ${o.target ? `đích ${o.target} khe` : 'sinh tồn'}`;
  if (r.game === 'goldmine') return `${o.levels} màn · 60 giây/màn`;
  if (r.game === 'snake') return `Cấp ${o.level} · ${SNAKE_MAZE[String(o.maze)] || ''}${o.minutes ? ` · ${o.minutes} phút` : ''}`;
  if (r.game === 'onet') return o.mode === 'classic' ? `Cổ điển · ${o.rows}×${o.cols} ô · ${o.minutes} phút/màn` : `${o.rows}×${o.cols} ô · ${o.minutes} phút${o.gravity ? ' · trọng lực' : ''}`;
  return '';
}
