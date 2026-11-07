import { useCallback, useEffect, useRef, useState } from 'react';
import { replayRace } from '@game/shared/race';
import type { RaceEngine, RaceInput, RacePlayerView } from '@game/shared/race';
import { request } from '../socket.js';

// Vòng lặp của người đang chơi trong các trò đua phát lại (Bay qua khe, Đào vàng): tự chạy engine theo
// đồng hồ, ghi lệnh [tick, lệnh], cứ SYNC_MS gửi lên server. Server đi trước (bị đẩy khi tab ẩn) hoặc
// đã xử dừng thì dựng lại đúng trạng thái server từ các lệnh server đã nhận.

const SYNC_MS = 300;
/** Một khung hình chạy bù tối đa chừng này bước (tab vừa mở lại). */
const MAX_CATCH_UP = 3000;

interface Runtime<G, C extends string> {
  game: G;
  log: RaceInput<C>[];
  sent: number;
  /** performance.now() ứng với bước 0. */
  base: number;
  lastSync: number;
  over: boolean;
}

interface RaceLoopOptions<G> {
  me: RacePlayerView;
  tickMs: number;
  /** performance.now() lúc bước 0 của ván. */
  startAt: number;
  create: () => G;
  /** Vẽ một khung; `alpha` 0..1 là phần đã trôi giữa hai bước để nội suy. */
  draw: (game: G, alpha: number, now: number) => void;
}

export function useRaceLoop<G extends RaceEngine<C>, C extends string>({ me, tickMs, startAt, create, draw }: RaceLoopOptions<G>) {
  const runtime = useRef<Runtime<G, C> | null>(null);
  if (!runtime.current) runtime.current = { game: create(), log: [], sent: 0, base: startAt, lastSync: 0, over: false };
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  const createRef = useRef(create);
  useEffect(() => { createRef.current = create; }, [create]);
  const [countdown, setCountdown] = useState(() => Math.max(0, Math.ceil((startAt - performance.now()) / 1000)));
  const [over, setOver] = useState(false);

  const sync = useCallback((final = false) => {
    const r = runtime.current!;
    if (!final && r.sent === r.log.length && performance.now() - r.lastSync < 1500) return;
    r.lastSync = performance.now();
    const inputs = r.log.slice(r.sent);
    r.sent = r.log.length;
    request('game:action', { type: 'raceSync', tick: r.game.tick, inputs }).catch(() => { /* lần gửi sau mang theo tick mới */ });
  }, []);

  useEffect(() => {
    const r = runtime.current!;
    if (me.tick <= r.game.tick && !(me.done && !r.over)) return;
    const log = r.log.slice(0, me.accepted);
    const game = createRef.current();
    replayRace(game, log, me.tick);
    r.game = game;
    r.log = log;
    r.sent = log.length;
    if (me.done) {
      r.over = true;
      setOver(true);
    }
  }, [me.tick, me.done, me.accepted]);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const r = runtime.current!;
      const now = performance.now();
      setCountdown(now < r.base ? Math.ceil((r.base - now) / 1000) : 0);
      if (!r.over && now >= r.base) {
        const due = Math.min(Math.floor((now - r.base) / tickMs), r.game.tick + MAX_CATCH_UP);
        while (!r.game.over && r.game.tick < due) r.game.step();
        if (r.game.over) {
          r.over = true;
          setOver(true);
          sync(true);
        } else if (now - r.lastSync > SYNC_MS) sync();
      }
      const alpha = r.over || now < r.base ? 0 : Math.min(1, Math.max(0, (now - r.base) / tickMs - r.game.tick));
      drawRef.current(r.game, alpha, now);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [tickMs, sync]);

  /** Ra lệnh ngay trên engine của mình; chỉ ghi lại để gửi khi engine nhận. */
  const command = useCallback((c: C) => {
    const r = runtime.current!;
    if (r.over || performance.now() < r.base || !r.game.command(c)) return false;
    r.log.push([r.game.tick, c]);
    return true;
  }, []);

  return { command, countdown, over, runtime };
}

/** Người dùng bật giảm chuyển động thì tắt cuộn nền và hiệu ứng phụ. */
export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
