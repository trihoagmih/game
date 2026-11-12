import { CHICKEN, CHICKEN_COMMANDS, ChickenGame } from '@game/shared/chicken';
import type { ChickenCommand, ChickenView } from '@game/shared/chicken';
import type { RaceEnd } from '@game/shared/race';
import type { Room } from '../lobby.js';
import type { GameHandler } from './types.js';
import { clampInt } from './options.js';
import { RaceHandler } from './race.js';
import type { RacePlayer } from './race.js';

interface ChickenOptions { maxSeats: number; level: number }
type ChickenPlayer = RacePlayer<ChickenGame, ChickenCommand>;

export class ChickenHandler extends RaceHandler<ChickenGame, ChickenCommand, ChickenOptions> implements GameHandler {
  readonly tickMs = CHICKEN.TICK_MS;
  protected readonly commands = CHICKEN_COMMANDS;

  constructor(room: Pick<Room, 'ownerId' | 'system' | 'changed'>, options: Record<string, unknown>) {
    super(room, { maxSeats: clampInt(options.maxSeats, 1, 8, 4), level: clampInt(options.level, 1, 3, 1) });
  }

  protected createGame(seed: number) { return new ChickenGame({ seed, level: this.options.level }); }
  protected maxTicks() { return CHICKEN.MAX_TICKS; }
  protected scoreOf(game: ChickenGame) { return game.score; }
  protected endOf(game: ChickenGame): RaceEnd { return game.lives <= 0 ? 'dead' : 'timedOut'; }
  protected compare(a: ChickenPlayer, b: ChickenPlayer) {
    return b.game.score - a.game.score || Number(a.end === 'gaveUp') - Number(b.end === 'gaveUp') || b.game.tick - a.game.tick;
  }
  protected endMessage(p: ChickenPlayer) { return `${p.name}: ${p.game.score} điểm · đợt ${p.game.wave}`; }
  protected startMessage() { return 'Bắn gà: né trứng, giữ 3 mạng và ghi nhiều điểm nhất trong 5 phút!'; }
  view(viewerId: string): ChickenView { return this.raceView(viewerId, (p) => ({ field: p.game.view() })); }
}
