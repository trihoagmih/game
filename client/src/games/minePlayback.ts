import type { MineSnapshot } from '@game/shared/goldmine';

interface MineFrame { mine: MineSnapshot; tick: number; at: number }
const PLAYBACK_DELAY_MS = 250;

/** Small delayed snapshot buffer: spectator motion runs on RAF, not socket arrival frequency. */
export class MinePlayback {
  private frames: MineFrame[] = [];

  push(mine: MineSnapshot, tick: number, at: number) {
    const last = this.frames.at(-1);
    if (last && tick === last.tick && mine.level === last.mine.level && mine.phase === last.mine.phase) return;
    if (last && (tick < last.tick || mine.level !== last.mine.level || mine.phase !== last.mine.phase)) this.frames = [];
    this.frames.push({ mine, tick, at });
    if (this.frames.length > 32) this.frames.shift();
  }

  sample(now: number) {
    const target = now - PLAYBACK_DELAY_MS;
    while (this.frames.length > 2 && this.frames[1].at <= target) this.frames.shift();
    const first = this.frames[0];
    if (!first) return null;
    const next = this.frames[1];
    if (!next || target <= first.at) return { mine: first.mine, previous: first.mine, alpha: 1, tick: first.tick };
    const alpha = Math.min(1, (target - first.at) / Math.max(1, next.at - first.at));
    return { mine: next.mine, previous: first.mine, alpha, tick: first.tick + (next.tick - first.tick) * alpha };
  }
}
