import type { RaceEngine, RaceInput } from '@game/shared/race';

const FRAME_BUDGET_MS = 4;
const MAX_FRAME_STEPS = 250;
export const SYNC_INPUT_LIMIT = 200;

/** Keep replay/catch-up inside a frame budget, including after a long background pause. */
export function advanceRaceFrame<C extends string>(game: RaceEngine<C>, target: number, inputs: readonly RaceInput<C>[] = [], from = 0,
  beforeStep?: () => void, now: () => number = () => performance.now()) {
  const deadline = now() + FRAME_BUDGET_MS;
  let used = from;
  let steps = 0;
  while (!game.over && game.tick < target && steps < MAX_FRAME_STEPS && now() < deadline) {
    while (used < inputs.length && inputs[used][0] <= game.tick) game.command(inputs[used++][1]);
    beforeStep?.();
    game.step();
    steps++;
  }
  return used;
}

export interface InputBatch<C extends string> { offset: number; inputs: RaceInput<C>[]; tick: number }

/** Only acknowledged inputs leave the retry queue; one batch may be in flight at a time. */
export class RaceInputQueue<C extends string> {
  log: RaceInput<C>[] = [];
  confirmed = 0;
  pending: InputBatch<C> | null = null;

  prepare(tick: number): InputBatch<C> | null {
    if (this.pending) return null;
    const inputs = this.log.slice(this.confirmed, this.confirmed + SYNC_INPUT_LIMIT);
    // Do not advance the server beyond commands that belong to the next batch.
    const next = this.log[this.confirmed + inputs.length];
    this.pending = { offset: this.confirmed, inputs, tick: next ? Math.min(tick, next[0]) : tick };
    return this.pending;
  }

  acknowledge(batch: InputBatch<C>, accepted: number) {
    if (this.pending !== batch) return;
    this.confirmed = Math.max(this.confirmed, Math.min(accepted, batch.offset + batch.inputs.length));
    this.pending = null;
  }

  retry(batch: InputBatch<C>) {
    if (this.pending === batch) this.pending = null;
  }

  reset(accepted: number) {
    this.log = this.log.slice(0, accepted);
    this.confirmed = this.log.length;
    this.pending = null;
  }
}
