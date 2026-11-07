import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Bomb } from 'lucide-react';
import { GoldmineGame as Engine, LEVEL_TICKS, MINE, TICK_MS } from '@game/shared/goldmine';
import type { GoldmineView, MineCommand, MinePlayerView, MineSnapshot } from '@game/shared/goldmine';
import type { MutableRefObject, ReactNode, RefObject } from 'react';
import type { ClientRoom } from '../store.js';
import RaceShell from '../components/RaceShell.js';
import { fmtClock, useCountdown, useHotkeys } from '../hooks.js';
import { drawMine, MINE_SCALE } from './goldmineRender.js';
import { prefersReducedMotion, useRaceLoop } from './useRaceLoop.js';
import './GoldmineGame.css';

// Đào vàng: chạm vào màn hình (hoặc Space, ↓) để phóng móc, B để dùng thuốc nổ phá món đang kéo.
// Thanh trên cùng hiện màn, tiền/mục tiêu, thời gian còn lại và số thuốc nổ của người đang được xem.

/** Thanh trạng thái chỉ cập nhật chừng này lần/giây để không render lại cả khung mỗi khung hình. */
const HUD_MS = 150;
const money = (n: number) => `${n.toLocaleString('vi-VN')}$`;

type Hud = Pick<MineSnapshot, 'level' | 'phase' | 'levelTick' | 'money' | 'goal' | 'dynamite'>;
const hudOf = (m: MineSnapshot): Hud => ({ level: m.level, phase: m.phase, levelTick: m.levelTick, money: m.money, goal: m.goal, dynamite: m.dynamite });
const sameHud = (a: Hud, b: Hud) => a.level === b.level && a.phase === b.phase && a.money === b.money && a.dynamite === b.dynamite
  && Math.ceil((LEVEL_TICKS - a.levelTick) * TICK_MS / 1000) === Math.ceil((LEVEL_TICKS - b.levelTick) * TICK_MS / 1000);

export default function GoldmineGame({ room, state: s }: { room: ClientRoom; state: GoldmineView }) {
  const me = s.players.find((p) => p.id === s.myId) ?? null;
  const [watchId, setWatchId] = useState<string | null>(null);
  const shown = me ?? s.players.find((p) => p.id === watchId) ?? s.players[0] ?? null;
  const live = s.status === 'playing' && me && !me.done;
  const [localHud, setLocalHud] = useState<Hud | null>(null);
  const commandRef = useRef<((c: MineCommand) => boolean) | null>(null);
  const hud = live && localHud ? localHud : shown && s.status !== 'waiting' ? hudOf(shown.mine) : null;
  const secondsLeft = hud ? Math.max(0, (LEVEL_TICKS - hud.levelTick) * TICK_MS) : 0;

  const stage = live
    ? <LocalPlay key={`${s.gameNo}-${me.id}`} s={s} me={me} room={room} onHud={setLocalHud} commandRef={commandRef} />
    : <Watch s={s} room={room} shown={s.status === 'waiting' ? null : shown} />;

  return (
    <RaceShell room={room} s={s} className="mine side-extra-wide" shownId={shown?.id ?? null} onPick={me ? null : setWatchId}
      note={(p) => `Màn ${s.players.find((x) => x.id === p.id)?.mine.level ?? 1}`} formatScore={money}
      toolbar={hud ? <>
        <span className="rc-tag">Màn <b>{hud.level}/{s.options.levels}</b></span>
        <span className={`rc-tag${hud.money < hud.goal ? ' low' : ''}`} title="Tiền / mục tiêu cuối màn">
          <b>{money(hud.money)}</b> / {money(hud.goal)}
        </span>
        <span className={`rc-tag${secondsLeft < 10_000 && hud.phase === 'play' ? ' low' : ''}`}><b>{fmtClock(secondsLeft)}</b></span>
        <span className="rc-tag"><Bomb size={14} aria-hidden /> <b>{hud.dynamite}</b><span className="sr-only"> thuốc nổ</span></span>
      </> : <span className="rc-tag"><b>{s.options.levels}</b> màn · 60 giây/màn</span>}
      stage={stage}
      controls={live && (
        <div className="rc-controls">
          <button type="button" className="btn primary" onClick={() => commandRef.current?.('shoot')}>
            <ArrowDownToLine size={18} aria-hidden /> Phóng móc
          </button>
          <button type="button" className="btn" disabled={!hud?.dynamite} onClick={() => commandRef.current?.('boom')}>
            <Bomb size={18} aria-hidden /> Thuốc nổ ({hud?.dynamite ?? 0})
          </button>
        </div>
      )}
      rules={<ul>
        <li>Móc lắc qua lại. Chạm vào màn hình, bấm <b>Space</b> hoặc <b>↓</b> để phóng móc.</li>
        <li>Vàng to và đá nặng kéo rất chậm; kim cương nhẹ mà đắt. Túi <b>?</b> có thể là tiền hoặc thuốc nổ.</li>
        <li>Đang kéo món không muốn lấy thì bấm <b>B</b> (Thuốc nổ) để phá, móc về nhanh.</li>
        <li>Mỗi màn 60 giây. Hết giờ mà tổng tiền chưa đạt mục tiêu thì dừng. Mọi người cùng bản đồ — nhiều tiền nhất thắng.</li>
      </ul>} />
  );
}

function Screen({ canvasRef, live, overlay, onPress }: {
  canvasRef: RefObject<HTMLCanvasElement>; live: boolean; overlay?: ReactNode; onPress?: () => void;
}) {
  return (
    <div className={`rc-screen${live ? ' live' : ''}`} tabIndex={live ? 0 : undefined} role={live ? 'button' : undefined}
      aria-label={live ? 'Mỏ vàng — chạm hoặc bấm Space để phóng móc' : undefined}
      onPointerDown={onPress ? (e) => { e.preventDefault(); onPress(); } : undefined}>
      <canvas ref={canvasRef} width={MINE.W * MINE_SCALE} height={MINE.H * MINE_SCALE} role="img" aria-label="Mỏ vàng" />
      {overlay}
    </div>
  );
}

function breakOverlay(hud: Hud | null, levels: number) {
  if (!hud || hud.phase !== 'break') return null;
  return <div className="rc-overlay"><strong>Qua màn {hud.level}!</strong><span>Màn {Math.min(levels, hud.level + 1)} — mục tiêu tăng lên</span></div>;
}

/** Người xem (hoặc người đã dừng): vẽ lại mỏ của người đang được chọn từ trạng thái server. */
function Watch({ s, room, shown }: { s: GoldmineView; room: ClientRoom; shown: MinePlayerView | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const startIn = useCountdown(Math.max(0, s.startIn), room.receivedAt, s.status === 'playing' && s.startIn > 0);
  const preview = useMemo(() => new Engine({ seed: 1, levels: 1 }).snapshot(), []);
  useEffect(() => {
    if (!cv.current) return;
    drawMine(cv.current, { mine: shown?.mine ?? { ...preview, items: [] }, boomAt: -Infinity, now: 0, still: true });
  });
  const overlay = s.status === 'waiting' || !shown
    ? <div className="rc-overlay"><strong>Đào vàng</strong><span>Chờ mọi người sẵn sàng, chủ phòng bấm Bắt đầu</span></div>
    : s.status === 'playing' && startIn > 0 ? <div className="rc-overlay clear"><span className="rc-count">{Math.ceil(startIn / 1000)}</span></div>
      : breakOverlay(hudOf(shown.mine), s.options.levels);
  return <Screen canvasRef={cv} live={false} overlay={overlay} />;
}

function LocalPlay({ s, me, room, onHud, commandRef }: {
  s: GoldmineView; me: MinePlayerView; room: ClientRoom; onHud: (hud: Hud) => void; commandRef: MutableRefObject<((c: MineCommand) => boolean) | null>;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const still = useMemo(prefersReducedMotion, []);
  const boomAt = useRef(-Infinity);
  const lastHud = useRef<{ at: number; hud: Hud | null }>({ at: 0, hud: null });
  const [hud, setHud] = useState<Hud | null>(null);
  const create = useCallback(() => new Engine({ seed: s.seed, levels: s.options.levels }), [s.seed, s.options.levels]);
  const draw = useCallback((game: Engine, _alpha: number, now: number) => {
    if (!cv.current) return;
    const mine = game.snapshot();
    drawMine(cv.current, { mine, boomAt: boomAt.current, now, still });
    const next = hudOf(mine);
    const prev = lastHud.current;
    if (prev.hud && (now - prev.at < HUD_MS || sameHud(prev.hud, next))) return;
    lastHud.current = { at: now, hud: next };
    setHud(next);
    onHud(next);
  }, [onHud, still]);
  const { command, countdown, over } = useRaceLoop<Engine, MineCommand>({
    me, tickMs: TICK_MS, startAt: room.receivedAt + s.startIn, create, draw,
  });
  const act = useCallback((c: MineCommand) => {
    const ok = command(c);
    if (ok && c === 'boom') boomAt.current = performance.now();
    return ok;
  }, [command]);
  useEffect(() => {
    commandRef.current = act;
    return () => { commandRef.current = null; };
  }, [act, commandRef]);
  useHotkeys({
    ' ': (e: KeyboardEvent) => { if (!e.repeat) act('shoot'); },
    ArrowDown: (e: KeyboardEvent) => { if (!e.repeat) act('shoot'); },
    b: () => act('boom'),
    B: () => act('boom'),
  });

  const overlay = countdown > 0
    ? <div className="rc-overlay clear"><span className="rc-count">{countdown}</span><span>Chạm để phóng móc</span></div>
    : over
      ? <div className="rc-overlay"><strong>{me.end === 'finished' ? 'Qua hết các màn!' : 'Dừng cuộc đào'}</strong><span>Chờ mọi người…</span></div>
      : breakOverlay(hud, s.options.levels);
  return <Screen canvasRef={cv} live overlay={overlay} onPress={() => act('shoot')} />;
}
