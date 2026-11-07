import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DIFFICULTY, SKY, SkyhopGame as Engine, TICK_MS } from '@game/shared/skyhop';
import type { SkyCommand, SkyPlayerView, SkyhopView } from '@game/shared/skyhop';
import type { ReactNode, RefObject } from 'react';
import type { ClientRoom } from '../store.js';
import RaceShell from '../components/RaceShell.js';
import { useCountdown, useHotkeys } from '../hooks.js';
import { drawSky, SKY_SCALE } from './skyhopRender.js';
import type { SkyGhost } from './skyhopRender.js';
import { prefersReducedMotion, useRaceLoop } from './useRaceLoop.js';
import './SkyhopGame.css';

// Bay qua khe: chạm/bấm vào màn hình (hoặc Space, ↑) để nảy. Người chơi tự chạy engine của mình,
// người xem vẽ lại từ trạng thái server gửi.

const KEYS = [' ', 'ArrowUp', 'w', 'W'];

export default function SkyhopGame({ room, state: s }: { room: ClientRoom; state: SkyhopView }) {
  const me = s.players.find((p) => p.id === s.myId) ?? null;
  const [watchId, setWatchId] = useState<string | null>(null);
  const shown = me ?? s.players.find((p) => p.id === watchId) ?? s.players[0] ?? null;
  const { level, target } = s.options;
  const live = s.status === 'playing' && me && !me.done;

  const stage = live
    ? <LocalPlay key={`${s.gameNo}-${me.id}`} s={s} me={me} room={room} />
    : <Watch s={s} room={room} shown={s.status === 'waiting' ? null : shown} />;

  return (
    <RaceShell room={room} s={s} className="sky side-wide" shownId={shown?.id ?? null} onPick={me ? null : setWatchId}
      note={(p) => (p.done ? '' : 'Đang bay')} formatScore={(n) => `${n} khe`}
      toolbar={<>
        <span className="rc-tag">Mức <b>{DIFFICULTY[level - 1].name}</b></span>
        <span className="rc-tag">{target ? <>Đích <b>{target} khe</b></> : <b>Sinh tồn</b>}</span>
      </>}
      stage={stage}
      rules={<ul>
        <li>Chạm vào màn hình, bấm <b>Space</b> hoặc <b>↑</b> để nảy lên; không bấm thì rơi.</li>
        <li>Luồn qua khe giữa hai cột đá. Chạm cột hoặc chạm đất là dừng.</li>
        <li>{target ? `Ai qua đủ ${target} khe trước thắng.` : 'Sinh tồn: qua nhiều khe nhất thắng, bằng nhau thì ai trụ lâu hơn.'}</li>
        <li>Mọi người gặp cùng một dãy cột. Chấm mờ là người khác — ở trước mặt là họ đang dẫn.</li>
      </ul>} />
  );
}

function ghostsOf(s: SkyhopView, exceptId: string | null): SkyGhost[] {
  return s.players.filter((p) => p.id !== exceptId).map((p) => ({ id: p.id, name: p.name, tick: p.tick, y: p.y, done: p.done }));
}

function Screen({ canvasRef, live, overlay, onPress }: {
  canvasRef: RefObject<HTMLCanvasElement>; live: boolean; overlay?: ReactNode; onPress?: () => void;
}) {
  return (
    <div className={`rc-screen${live ? ' live' : ''}`} tabIndex={live ? 0 : undefined} role={live ? 'button' : undefined}
      aria-label={live ? 'Màn hình bay — chạm hoặc bấm Space để nảy' : undefined}
      onPointerDown={onPress ? (e) => { e.preventDefault(); onPress(); } : undefined}>
      <canvas ref={canvasRef} width={SKY.W * SKY_SCALE} height={SKY.H * SKY_SCALE} role="img" aria-label="Bay qua khe" />
      {overlay}
    </div>
  );
}

/** Người xem (hoặc người đã dừng): vẽ lại người đang được chọn từ trạng thái server. */
function Watch({ s, room, shown }: { s: SkyhopView; room: ClientRoom; shown: SkyPlayerView | null }) {
  const startIn = useCountdown(Math.max(0, s.startIn), room.receivedAt, s.status === 'playing' && s.startIn > 0);
  const cv = useRef<HTMLCanvasElement>(null);
  const world = useMemo(() => new Engine({ seed: s.seed, level: s.options.level, target: s.options.target }), [s.seed, s.options.level, s.options.target]);
  useEffect(() => {
    if (!cv.current) return;
    drawSky(cv.current, {
      tick: shown?.tick ?? 0, alpha: 0, y: shown?.y ?? 220 * 16, vy: shown?.vy ?? 0, score: shown?.score ?? 0,
      target: s.options.target, speed: world.speed, gap: world.gap, gapCenter: (k) => world.gapCenter(k),
      dead: shown?.end === 'dead', ghosts: ghostsOf(s, shown?.id ?? null), still: true,
    });
  });
  const overlay = s.status === 'waiting' || !shown
    ? <div className="rc-overlay"><strong>Bay qua khe</strong><span>Chờ mọi người sẵn sàng, chủ phòng bấm Bắt đầu</span></div>
    : s.status === 'playing' && startIn > 0 ? <div className="rc-overlay clear"><span className="rc-count">{Math.ceil(startIn / 1000)}</span></div>
      : null;
  return <Screen canvasRef={cv} live={false} overlay={overlay} />;
}

function LocalPlay({ s, me, room }: { s: SkyhopView; me: SkyPlayerView; room: ClientRoom }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const sRef = useRef(s);
  useEffect(() => { sRef.current = s; }, [s]);
  const still = useMemo(prefersReducedMotion, []);
  const create = useCallback(() => new Engine({ seed: s.seed, level: s.options.level, target: s.options.target }), [s.seed, s.options.level, s.options.target]);
  const draw = useCallback((game: Engine, alpha: number) => {
    if (!cv.current) return;
    drawSky(cv.current, {
      tick: game.tick, alpha, y: game.y, vy: game.vy, score: game.score, target: game.target, speed: game.speed, gap: game.gap,
      gapCenter: (k) => game.gapCenter(k), dead: game.dead, ghosts: ghostsOf(sRef.current, me.id), still,
    });
  }, [cv, me.id, still]);
  const { command, countdown, over } = useRaceLoop<Engine, SkyCommand>({
    me, tickMs: TICK_MS, startAt: room.receivedAt + s.startIn, create, draw,
  });
  const flap = useCallback(() => { command('flap'); }, [command]);
  useHotkeys(Object.fromEntries(KEYS.map((k) => [k, (e: KeyboardEvent) => { if (!e.repeat) flap(); }])));

  const overlay = countdown > 0
    ? <div className="rc-overlay clear"><span className="rc-count">{countdown}</span><span>Chạm để nảy</span></div>
    : over
      ? <div className="rc-overlay"><strong>{me.end === 'finished' ? 'Về đích!' : 'Va rồi!'}</strong><span>Chờ mọi người…</span></div>
      : null;
  return <Screen canvasRef={cv} live overlay={overlay} onPress={flap} />;
}
