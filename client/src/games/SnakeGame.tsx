import type { Direction, SnakeInput, SnakeView, SnakePlayerView, SnakeScore } from '@game/shared/snake';
import type { RoomState } from '@game/shared/contracts';
import type { ReactNode, RefObject, TouchEventHandler } from 'react';
import type { RenderState, SnakeEffect } from './snakeRender.js';
type ClientRoom = RoomState & {receivedAt: number};
type Beep = (notes: [number, number][]) => void;
interface PhoneProps {theme: string; st?: SnakePlayerView | null; maze: string; label: string; children?: ReactNode; canvasRef?: RefObject<HTMLCanvasElement>; overlay?: ReactNode; onTouchStart?: TouchEventHandler; onTouchEnd?: TouchEventHandler; pad?: ReactNode}
interface LocalRuntime {game: Engine; log: SnakeInput[]; sent: number; base: number; paused: boolean; pausedAt: number; lastSync: number; over: boolean; fx: SnakeEffect[]}
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, Timer, Trophy, Volume2, VolumeX, Pause, Play } from 'lucide-react';
import { SnakeGame as Engine, replay, mazeWalls, BONUS_TICKS } from '@game/shared/snake';
import { drawClassic, drawModern, SIZE } from './snakeRender.js';
import { useRoomApp } from '../store.js';
import type { Call } from '../store.js';
import { request } from '../socket.js';
import { useCountdown, useHotkeys, fmtClock } from '../hooks.js';
import GameInfo from '../components/GameInfo.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import './SnakeGame.css';

// Rắn săn mồi — hai kiểu nhìn (mỗi người tự chọn, luật như nhau): "Cổ điển" màn hình LCD vàng của
// điện thoại đen trắng, và "Hiện đại" bàn neon rắn trượt mượt. Cách vẽ nằm ở snakeRender.js.

export const MAZE_LABEL: Record<string, string> = { none: 'Không tường', box: 'Hộp kín', tunnel: 'Đường hầm', rooms: 'Bốn phòng', rails: 'Đường ray' };

const SYNC_MS = 300;

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', 2: 'up', 8: 'down', 4: 'left', 6: 'right',
};

const MUTE_KEY = 'gl_snake_mute';
const THEME_KEY = 'gl_snake_theme';

function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem(THEME_KEY) || 'classic'; } catch { return 'classic'; } });
  const set = (v: string) => { setTheme(v); try { localStorage.setItem(THEME_KEY, v); } catch { /* bỏ qua */ } };
  return [theme, set] as const;
}

const paint = (theme: string, cv: HTMLCanvasElement, st: RenderState, f: number, now?: number) => (theme === 'modern' ? drawModern(cv, st, f, now) : drawClassic(cv, st));

/** Tiếng bíp sóng vuông kiểu điện thoại cổ. */
function useBeeper() {
  const ctx = useRef<AudioContext | null>(null);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const beep = useCallback((notes: [number, number][]) => {
    if (mutedRef.current) return;
    try {
      ctx.current ||= new (window.AudioContext || window.webkitAudioContext)();
      const ac = ctx.current;
      let t = ac.currentTime;
      for (const [freq, ms] of notes) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'square';
        o.frequency.value = freq;
        g.gain.value = 0.05;
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + ms / 1000);
        t += ms / 1000;
      }
    } catch { /* trình duyệt chặn âm thanh */ }
  }, []);
  const toggle = () => setMuted((m) => {
    try { localStorage.setItem(MUTE_KEY, m ? '0' : '1'); } catch { /* bỏ qua */ }
    return !m;
  });
  return { beep, muted, toggle };
}

export default function SnakeGame({ room, state: s }: {room: ClientRoom; state: SnakeView}) {
  const { call, user } = useRoomApp();
  const playing = s.status === 'playing';
  const me = s.players.find((p) => p.id === s.myId) || null;
  const [watchId, setWatchId] = useState<string | null>(null);
  const shown = me || s.players.find((p) => p.id === watchId) || s.players[0] || null;
  const timeLeft = useCountdown(s.timeLeft, room.receivedAt, playing && !!s.timeTotal);
  const [giveup, setGiveup] = useState(false);
  const { beep, muted, toggle } = useBeeper();
  const [theme, setTheme] = useTheme();
  const canPlay = playing && me && !me.done;

  return (
    <div className="snake">
      <div className="snake-main">
        <Racers s={s} ownerId={room.ownerId} shownId={shown?.id} onPick={me ? null : setWatchId} />

        <div className="snake-bar">
          <span className="snake-tag">Cấp <b>{s.options.level}</b></span>
          <span className="snake-tag">{MAZE_LABEL[s.options.maze]}</span>
          {!!s.timeTotal && (
            <span className={`snake-time ${playing && timeLeft < 30000 ? 'low' : ''}`}>
              <Timer size={15} aria-hidden /> {fmtClock(playing ? timeLeft : s.timeTotal)}
            </span>
          )}
          <span className="snake-sp" />
          <span className="snake-theme" role="radiogroup" aria-label="Kiểu hình">
            <button type="button" role="radio" aria-checked={theme === 'classic'} className={theme === 'classic' ? 'on' : ''} onClick={() => setTheme('classic')}>📟 Cổ điển</button>
            <button type="button" role="radio" aria-checked={theme === 'modern'} className={theme === 'modern' ? 'on' : ''} onClick={() => setTheme('modern')}>✨ Hiện đại</button>
          </span>
          <button className="btn sm ghost" onClick={toggle} title={muted ? 'Bật tiếng' : 'Tắt tiếng'} aria-label={muted ? 'Bật tiếng' : 'Tắt tiếng'}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          {canPlay && (
            <button className="btn sm danger" onClick={() => setGiveup(true)} title="Bỏ cuộc" aria-label="Bỏ cuộc"><Flag size={15} aria-hidden /></button>
          )}
        </div>

        <div className="snake-stage">
          {shown && s.status !== 'waiting' ? (
            me && shown.id === me.id && playing ? (
              <LocalPlay key={`${s.gameNo}-${me.id}`} s={s} me={me} room={room} beep={beep} theme={theme} />
            ) : (
              <Phone theme={theme} st={shown} maze={s.options.maze} label={shown.name} />
            )
          ) : (
            <Phone theme={theme} st={null} maze={s.options.maze} label="Rắn săn mồi">
              <div className="snake-wait">
                <div className="snake-big">RẮN SĂN MỒI</div>
                <div>Dùng phím mũi tên / 2 4 6 8 để điều khiển</div>
                <div className="small">Chờ mọi người sẵn sàng, chủ phòng bấm Bắt đầu</div>
              </div>
            </Phone>
          )}
        </div>

        {s.status === 'over' && s.result && <Result s={s} me={user.id} call={call} />}

        {s.status !== 'over' && (!playing || !s.myId) && <div className="board-actions">
          {!playing && (s.myId ? (
            <>
              <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated min={1}
                startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />
              <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            </>
          ) : (
            <>
              <span className="muted small ba-note">
                Bạn đang xem.{' '}
                {s.seats.length < s.options.maxSeats && <button className="btn primary sm" onClick={() => call('room:sit', {})}>Vào chơi</button>}
              </span>
              <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={false} min={1}
                startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />
            </>
          ))}
          {playing && !s.myId && <span className="muted small">Bạn đang xem — bấm vào tên người chơi để xem rắn của họ</span>}
        </div>}

        {giveup && (
          <ConfirmDialog title="Bỏ cuộc ván này?" danger okLabel="Bỏ cuộc" icon={<Flag size={22} />}
            onOk={() => call('game:action', { type: 'giveup' })} onClose={() => setGiveup(false)}>
            Điểm hiện tại được giữ, nhưng bạn xếp sau người cùng điểm còn chơi tới cùng.
          </ConfirmDialog>
        )}
      </div>

      <GameInfo>
        <Wins wins={s.wins} me={user.id} />
        <div className="panel small muted">
          <b>Luật chơi</b>
          <ul>
            <li>Điều khiển rắn bằng <b>phím mũi tên</b>, <b>W A S D</b> hoặc <b>2 4 6 8</b> như bàn phím điện thoại; trên điện thoại thì vuốt hoặc bấm nút.</li>
            <li>Mỗi mồi ◆ được <b>{s.options.level} điểm</b> (bằng cấp tốc độ) và rắn dài thêm một đốt.</li>
            <li>Cứ 5 mồi lại hiện một <b>con thưởng</b> trong {BONUS_TICKS} bước — ăn càng sớm càng nhiều điểm.</li>
            <li>Đâm vào thân mình{s.options.maze !== 'none' ? ' hoặc tường' : ''} là hết ván.{s.options.maze === 'none' || s.options.maze === 'tunnel' || s.options.maze === 'rails' ? ' Chỗ không có viền thì rắn đi xuyên sang mép bên kia.' : ''}</li>
            <li>{s.solo || s.players.length <= 1 ? 'Chơi một mình được tạm dừng (P / Space).' : 'Nhiều người: mọi người cùng mồi đầu tiên, không được tạm dừng, ai nhiều điểm nhất thắng.'}{s.timeTotal ? ` Hết ${s.options.minutes} phút thì dừng.` : ''}</li>
          </ul>
        </div>
      </GameInfo>
    </div>
  );
}

/** Khung "điện thoại" chứa màn hình LCD. */
function Phone({ theme, st, maze, label, children, canvasRef, overlay, onTouchStart, onTouchEnd, pad }: PhoneProps) {
  const own = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef || own;
  useEffect(() => {
    if (canvasRef || !ref.current) return;
    const walls = wallsOf(maze);
    paint(theme, ref.current, st ? { ...st, walls } : { snake: [], food: -1, bonus: null, score: 0, walls }, 0);
  });
  return (
    <div className={`snake-phone ${theme}`}>
      <div className="snake-brand" aria-hidden>{label}</div>
      <div className="snake-lcd" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <canvas key={theme} ref={ref} width={SIZE[theme].w} height={SIZE[theme].h} aria-label={`Màn hình rắn của ${label}`} role="img" />
        {children}
        {overlay}
      </div>
      {pad}
    </div>
  );
}

// Danh sách ô tường theo mê cung (vẽ bàn của người khác / màn chờ)
const wallCache = new Map<string, number[]>();
function wallsOf(maze: string) {
  if (!wallCache.has(maze)) wallCache.set(maze, [...mazeWalls(maze)]);
  return wallCache.get(maze)!;
}

/** Người chơi tự chạy rắn của mình; định kỳ gửi lượt rẽ lên server để server phát lại và chấm điểm. */
function LocalPlay({ s, me, room, beep, theme }: {s: SnakeView; me: SnakePlayerView; room: ClientRoom; beep: Beep; theme: string}) {
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const cv = useRef<HTMLCanvasElement>(null);
  const opts = { seed: s.seed, maze: s.options.maze, level: s.options.level };
  const R = useRef<LocalRuntime>(null!);
  if (!R.current) {
    R.current = {
      game: new Engine(opts),
      log: [], // các lượt rẽ đã nhận [tick, dir]
      sent: 0,
      base: room.receivedAt + s.startIn, // performance.now() lúc bước 0
      paused: false,
      pausedAt: 0,
      lastSync: 0,
      over: false,
      fx: [], // hiệu ứng nổ hạt (kiểu hiện đại)
    };
  }
  const [, force] = useState(0);
  const [count, setCount] = useState(Math.ceil(Math.max(0, s.startIn) / 1000));
  const solo = s.solo;

  const sync = useCallback((final = false) => {
    const r = R.current;
    if (!final && r.sent === r.log.length && performance.now() - r.lastSync < 1500) return;
    r.lastSync = performance.now();
    const inputs = r.log.slice(r.sent);
    r.sent = r.log.length;
    request('game:action', { type: 'sync', tick: r.game.tick, inputs }).catch(() => { /* gửi lại ở lần sau */ });
  }, []);

  // Server đi trước (bị tự đẩy khi tab bị ẩn) hoặc đã xử thua → dựng lại đúng trạng thái server
  useEffect(() => {
    const r = R.current;
    if (me.tick > r.game.tick || (me.done && !r.over)) {
      const log = r.log.slice(0, me.accepted);
      const { game } = replay(opts, log, me.tick);
      r.game = game;
      r.log = log;
      r.sent = log.length;
      r.base = performance.now() - me.tick * s.tickMs;
      if (me.done) r.over = true;
      force((n) => n + 1);
    }
  }, [me.tick, me.done, me.accepted]);

  // Vòng lặp khung hình
  useEffect(() => {
    let raf = 0;
    const walls = [...R.current.game.walls];
    let alive = true;
    const loop = () => {
      if (!alive || !cv.current) return;
      raf = requestAnimationFrame(loop);
      const r = R.current;
      const now = performance.now();
      const g = r.game;
      if (now < r.base) setCount(Math.ceil((r.base - now) / 1000));
      else setCount(0);
      if (!r.over && !r.paused && now >= r.base) {
        let due = Math.floor((now - r.base) / s.tickMs);
        // Tab bị ẩn rồi mở lại: không "tua nhanh" — coi như dừng lúc đó
        if (due - g.tick > 4) { r.base = now - g.tick * s.tickMs; due = g.tick; }
        while (g.alive && g.tick < due) {
          const ev = g.step();
          if (ev === 'eat') { beep([[1760, 40]]); r.fx.push({ i: g.head, t0: now, c: '#ff6fa5' }); }
          else if (ev === 'bonus') { beep([[1320, 40], [1760, 40], [2093, 60]]); r.fx.push({ i: g.head, t0: now, c: '#fbbf24' }); }
          else if (ev === 'die') {
            beep([[440, 120], [330, 120], [220, 260]]);
            r.over = true;
            sync(true);
            force((n) => n + 1);
          }
        }
        if (now - r.lastSync > SYNC_MS && !r.over) sync();
      }
      if (r.fx.length > 8) r.fx.splice(0, r.fx.length - 8);
      const f = r.over || r.paused || now < r.base ? 0 : Math.min(1, Math.max(0, (now - r.base) / s.tickMs - g.tick));
      paint(themeRef.current, cv.current, {
        ...g.snapshot(), nextDir: g.queue[0], score: g.score, length: g.length, walls, fx: r.fx,
        dead: r.over, blink: Math.floor(now / 250) % 2 === 0,
      }, f, now);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [s.tickMs, beep, sync]);

  // Nút đang được nhấn trên bàn phím ảo (sáng lên cả khi bấm phím thật hay vuốt)
  const [pressed, setPressed] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pressTimer.current), []);
  const press = useCallback((k: string) => {
    setPressed(k);
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressed(null), 140);
  }, []);
  const turn = useCallback((dir: Direction) => {
    press(dir);
    const r = R.current;
    if (r.over || r.paused) return;
    if (r.game.turn(dir)) r.log.push([r.game.tick, dir]);
  }, [press]);

  const togglePause = useCallback(() => {
    const r = R.current;
    if (!solo || r.over || performance.now() < r.base) return;
    if (!r.paused) { r.paused = true; r.pausedAt = performance.now(); sync(true); } else { r.base += performance.now() - r.pausedAt; r.paused = false; }
    force((n) => n + 1);
  }, [solo, sync]);

  useHotkeys({
    ...Object.fromEntries(Object.entries(KEYS).map(([k, d]) => [k, () => turn(d)])),
    p: togglePause,
    ' ': togglePause,
  });

  // Vuốt trên màn hình
  const touch = useRef<[number, number] | null>(null);
  const onTouchStart: TouchEventHandler = (e) => { const t = e.touches[0]; touch.current = [t.clientX, t.clientY]; };
  const onTouchEnd: TouchEventHandler = (e) => {
    if (!touch.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current[0], dy = t.clientY - touch.current[1];
    touch.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };

  const r = R.current;
  const overlay = count > 0 ? <div className="snake-over big">{count}</div>
    : r.paused ? <div className="snake-over">TẠM DỪNG<div className="small">bấm P hoặc Space để chơi tiếp</div></div>
      : r.over ? <div className="snake-over">HẾT VÁN<div>{r.game.score} điểm</div><div className="small">chờ mọi người…</div></div> : null;

  const pad = (
    <div className="snake-pad">
      <button type="button" className={`k up ${pressed === 'up' ? 'on' : ''}`} onPointerDown={(e) => { e.preventDefault(); turn('up'); }} aria-label="Lên">▲</button>
      <button type="button" className={`k left ${pressed === 'left' ? 'on' : ''}`} onPointerDown={(e) => { e.preventDefault(); turn('left'); }} aria-label="Trái">◀</button>
      {solo ? (
        <button type="button" className={`k mid ${pressed === 'mid' ? 'on' : ''}`} onPointerDown={() => press('mid')} onClick={togglePause} aria-label={r.paused ? 'Chơi tiếp' : 'Tạm dừng'}>
          {r.paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      ) : <span className="k mid blank" />}
      <button type="button" className={`k right ${pressed === 'right' ? 'on' : ''}`} onPointerDown={(e) => { e.preventDefault(); turn('right'); }} aria-label="Phải">▶</button>
      <button type="button" className={`k down ${pressed === 'down' ? 'on' : ''}`} onPointerDown={(e) => { e.preventDefault(); turn('down'); }} aria-label="Xuống">▼</button>
    </div>
  );

  return <Phone theme={theme} canvasRef={cv} maze={s.options.maze} label={me.name} overlay={overlay} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} pad={pad} />;
}

function Racers({ s, ownerId, shownId, onPick }: {s: SnakeView; ownerId: string; shownId: string | undefined; onPick?: ((id: string) => void) | null}) {
  const list = s.status === 'waiting' || !s.players.length
    ? s.seats.map((x) => ({ ...x, score: 0, length: 0, done: false, gaveUp: false, dead: false, timedOut: false }))
    : s.players;
  return (
    <div className="onet-racers">
      {list.map((p) => {
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag key={p.id} className={`onet-racer ${p.id === s.myId ? 'me' : ''} ${p.id === shownId && onPick ? 'shown' : ''} ${p.gaveUp ? 'out' : ''}`}
            {...(onPick ? { type: 'button', onClick: () => onPick(p.id) } : {})}>
            <div className="onet-rname">
              {p.name}{p.id === s.myId && <span className="muted"> (bạn)</span>}
              {s.status !== 'playing' && <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />}
            </div>
            {s.status !== 'waiting' && (
              <div className="small muted">
                {p.gaveUp ? 'Bỏ cuộc' : p.timedOut ? 'Hết giờ' : p.dead ? '💥 Đã đâm' : s.status === 'playing' ? '🐍 Đang bò' : ''} · dài {p.length} · <b className="onet-pts">{p.score}</b> điểm
              </div>
            )}
          </Tag>
        );
      })}
      {list.length === 0 && <div className="muted small">Chưa có ai ngồi</div>}
    </div>
  );
}

function Result({ s, me, call }: {s: SnakeView; me: string; call: Call}) {
  const byId = (id: string | null) => s.players.find((p) => p.id === id);
  const winner = byId(s.result!.winner);
  const solo = s.players.length === 1;
  const title = solo ? `🐍 ${s.players[0].score} điểm · dài ${s.players[0].length}`
    : winner ? <>🏆 {winner.id === me ? 'Bạn' : winner.name} thắng!</> : 'Không ai thắng';
  const rows = s.result!.ranking.map((id) => {
    const p = byId(id)!;
    return { id, name: p.name, value: p.score, note: `dài ${p.length} · ${p.gaveUp ? 'bỏ cuộc' : p.timedOut ? 'hết giờ' : `trụ ${fmtClock(p.endedAt || 0)}`}` };
  });
  return (
    <GameOverDialog over icon={<Trophy size={26} />} title={title} min={1}
      seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} reviewLabel="Xem lại màn hình"
      seatBtn={s.myId ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
        : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}>
      <GoRanking me={me} rows={rows} />
    </GameOverDialog>
  );
}

function Wins({ wins, me }: {wins: SnakeScore[]; me: string}) {
  if (!wins.length) return null;
  return (
    <div className="panel">
      <h4>Bảng thành tích</h4>
      <table className="sb-table">
        <thead><tr><th>#</th><th>Người chơi</th><th>Ván</th><th>Thắng</th><th>Cao nhất</th><th>Dài nhất</th></tr></thead>
        <tbody>
          {wins.map((w, i) => (
            <tr key={w.id} className={w.id === me ? 'me' : ''}>
              <td>{i === 0 && w.wins > 0 ? <Trophy size={14} aria-label="Dẫn đầu" /> : i + 1}</td>
              <td className="sb-name">{w.name}</td>
              <td>{w.games}</td>
              <td><b>{w.wins}</b></td>
              <td>{w.best}</td>
              <td>{w.longest}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
