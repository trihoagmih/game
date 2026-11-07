import { DIFFICULTY, MAX_TICKS, SKY_COMMANDS, SkyhopGame, TARGET, TICK_MS } from '@game/shared/skyhop';
import type { RaceEnd } from '@game/shared/race';
import type { SkyCommand, SkyhopView } from '@game/shared/skyhop';
import type { Room } from '../lobby.js';
import type { GameHandler } from './types.js';
import { clampInt } from './options.js';
import { RaceHandler } from './race.js';
import type { RacePlayer } from './race.js';

// Bay qua khe: mọi người cùng dãy cột. Có mục tiêu thì ai qua đủ số khe trước thắng; mục tiêu 0 là
// sinh tồn — qua nhiều khe nhất thắng, bằng nhau thì ai trụ lâu hơn.

interface SkyOptions { maxSeats: number; level: number; target: number }
type SkyPlayer = RacePlayer<SkyhopGame, SkyCommand>;

export class SkyhopHandler extends RaceHandler<SkyhopGame, SkyCommand, SkyOptions> implements GameHandler {
  readonly tickMs = TICK_MS;
  protected readonly commands = SKY_COMMANDS;

  constructor(room: Pick<Room, 'ownerId' | 'system' | 'changed'>, options: Record<string, unknown>) {
    super(room, {
      maxSeats: clampInt(options.maxSeats, 1, 8, 4),
      level: clampInt(options.level, 1, DIFFICULTY.length, 2),
      target: clampInt(options.target, TARGET.min, TARGET.max, TARGET.default),
    });
  }

  protected createGame(seed: number) { return new SkyhopGame({ seed, level: this.options.level, target: this.options.target }); }
  protected maxTicks() { return MAX_TICKS; }
  protected scoreOf(game: SkyhopGame) { return game.score; }
  protected endOf(game: SkyhopGame): RaceEnd { return game.dead ? 'dead' : game.finished ? 'finished' : 'timedOut'; }

  protected compare(a: SkyPlayer, b: SkyPlayer) {
    const finished = Number(b.end === 'finished') - Number(a.end === 'finished');
    if (finished) return finished;
    if (a.end === 'finished') return a.game.tick - b.game.tick; // về đích sớm hơn đứng trên
    return b.game.score - a.game.score || Number(a.end === 'gaveUp') - Number(b.end === 'gaveUp') || b.game.tick - a.game.tick;
  }

  protected endMessage(p: SkyPlayer) {
    if (p.end === 'finished') return `🏁 ${p.name} về đích sau ${(p.game.tick * TICK_MS / 1000).toFixed(1)} giây`;
    return `💥 ${p.name} ${p.end === 'dead' ? 'va phải' : 'hết giờ'} — qua ${p.game.score} khe`;
  }

  protected startMessage() {
    const { level, target } = this.options;
    const goal = target ? `ai qua ${target} khe trước thắng` : 'sinh tồn, qua nhiều khe nhất thắng';
    return `Ván ${this.gameNo}: mức ${DIFFICULTY[level - 1].name}, ${goal}. Chuẩn bị…`;
  }

  view(viewerId: string): SkyhopView {
    return this.raceView(viewerId, (p) => ({ y: p.game.y, vy: p.game.vy }));
  }
}
