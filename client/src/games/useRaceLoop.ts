import { useCallback, useEffect, useRef, useState } from 'react';
import type { RaceEngine, RacePlayerView } from '@game/shared/race';
import { send } from '../socket.js';
import { advanceRaceFrame, RaceInputQueue } from './raceRuntime.js';

const SYNC_MS = 300;

interface Runtime<G, C extends string> {
  game: G;
  queue: RaceInputQueue<C>;
  base: number;
  lastSync: number;
  over: boolean;
  recovery: { game: G; target: number; used: number; done: boolean } | null;
}

interface RaceLoopOptions<G> {
  me: RacePlayerView;
  gameNo: number;
  tickMs: number;
  /** performance.now() ứng với bước 0 của ván. */
  startAt: number;
  create: () => G;
  beforeStep?: (game: G) => void;
  draw: (game: G, alpha: number, now: number) => void;
}

export function useRaceLoop<G extends RaceEngine<C>, C extends string>({ me, gameNo, tickMs, startAt, create, beforeStep, draw }: RaceLoopOptions<G>) {
  const runtime = useRef<Runtime<G, C> | null>(null);
  if (!runtime.current) runtime.current = { game: create(), queue: new RaceInputQueue<C>(), base: startAt, lastSync: 0, over: false, recovery: null };
  const drawRef = useRef(draw);
  const stepRef = useRef(beforeStep);
  const createRef = useRef(create);
  useEffect(() => { drawRef.current = draw; stepRef.current = beforeStep; createRef.current = create; }, [draw, beforeStep, create]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [countdown, setCountdown] = useState(() => Math.max(0, Math.ceil((startAt - performance.now()) / 1000)));
  const countdownRef = useRef(countdown);
  const [over, setOver] = useState(false);

  const recover = useCallback((tick: number, accepted: number, done: boolean) => {
    const r = runtime.current!;
    if (r.recovery && r.queue.log.length === accepted) {
      r.recovery.target = Math.max(r.recovery.target, tick);
      r.recovery.done ||= done;
      return;
    }
    r.queue.reset(accepted);
    r.recovery = { game: createRef.current(), target: tick, used: 0, done };
  }, []);

  const finalAck = useRef(false);
  const sync = useCallback(() => {
    const r = runtime.current!;
    if (r.recovery || r.queue.pending) return;
    const now = performance.now();
    const interval = r.queue.confirmed < r.queue.log.length || r.over ? SYNC_MS : 1500;
    if (now - r.lastSync < interval) return;
    // After a final ACK there is no more work; a lost final ACK still retries.
    if (r.over && r.queue.confirmed === r.queue.log.length && finalAck.current) return;
    const batch = r.queue.prepare(r.game.tick);
    if (!batch) return;
    r.lastSync = now;
    send('game:action', { type: 'raceSync', gameNo, offset: batch.offset, tick: batch.tick, inputs: batch.inputs }, 1500).then(({ race }) => {
      if (!mounted.current || r.queue.pending !== batch) return;
      if (!race || race.gameNo !== gameNo) { r.queue.retry(batch); return; }
      r.queue.acknowledge(batch, race.accepted);
      if (race.resync || race.tick > r.game.tick || (race.done && !r.over)) {
        recover(race.tick, race.accepted, race.done);
      } else if (race.done) finalAck.current = true;
    }).catch(() => {
      // Keep the same unconfirmed suffix for retry, including the final batch.
      if (mounted.current) r.queue.retry(batch);
    });
  }, [gameNo, recover]);

  useEffect(() => {
    const r = runtime.current!;
    if (me.tick <= r.game.tick && !(me.done && !r.over)) return;
    recover(me.tick, me.accepted, me.done);
  }, [me.tick, me.done, me.accepted, recover]);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const r = runtime.current!;
      const now = performance.now();
      const nextCountdown = now < r.base ? Math.ceil((r.base - now) / 1000) : 0;
      if (nextCountdown !== countdownRef.current) {
        countdownRef.current = nextCountdown;
        setCountdown(nextCountdown);
      }
      if (r.recovery) {
        const recovery = r.recovery;
        recovery.used = advanceRaceFrame(recovery.game, recovery.target, r.queue.log, recovery.used);
        if (recovery.game.over || recovery.game.tick >= recovery.target) {
          r.game = recovery.game;
          r.over = recovery.done || r.game.over;
          r.recovery = null;
          setOver(r.over);
        }
      } else if (!r.over && now >= r.base) {
        const due = Math.floor((now - r.base) / tickMs);
        advanceRaceFrame(r.game, due, [], 0, () => stepRef.current?.(r.game));
        if (r.game.over) { r.over = true; setOver(true); }
      }
      sync();
      const alpha = r.over || now < r.base ? 1 : Math.min(1, Math.max(0, (now - r.base) / tickMs - r.game.tick));
      drawRef.current(r.game, alpha, now);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [tickMs, sync]);

  const command = useCallback((c: C) => {
    const r = runtime.current!;
    // Never stamp an input with an old tick while catching up after a background pause.
    if (r.over || r.recovery || performance.now() < r.base || (performance.now() - r.base) / tickMs - r.game.tick > 2 || !r.game.command(c)) return false;
    r.queue.log.push([r.game.tick, c]);
    return true;
  }, [tickMs]);

  return { command, countdown, over, runtime };
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
