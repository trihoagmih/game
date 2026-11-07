import { GoldmineGame, LEVEL_COUNT, MINE_COMMANDS, TICK_MS } from '@game/shared/goldmine';
import type { GoldmineView, MineCommand } from '@game/shared/goldmine';
import type { RaceEnd } from '@game/shared/race';
import type { Room } from '../lobby.js';
import type { GameHandler } from './types.js';
import { clampInt } from './options.js';
import { RaceHandler } from './race.js';
import type { RacePlayer } from './race.js';

// Đào vàng: mọi người cùng bản đồ từng màn, đua tiền. Hết màn mà chưa đạt mục tiêu cộng dồn thì dừng.
// Xếp hạng theo tiền; bằng tiền thì ai đi được xa hơn đứng trên.

interface MineOptions { maxSeats: number; levels: number }
type MinePlayer = RacePlayer<GoldmineGame, MineCommand>;

export class GoldmineHandler extends RaceHandler<GoldmineGame, MineCommand, MineOptions> implements GameHandler {
  readonly tickMs = TICK_MS;
  protected readonly commands = MINE_COMMANDS;

  constructor(room: Pick<Room, 'ownerId' | 'system' | 'changed'> & Partial<Pick<Room, 'recordScore' | 'workspaceRecord'>>, options: Record<string, unknown>) {
    super(room, {
      maxSeats: clampInt(options.maxSeats, 1, 8, 4),
      levels: clampInt(options.levels, LEVEL_COUNT.min, LEVEL_COUNT.max, LEVEL_COUNT.default),
    });
  }

  protected createGame(seed: number) { return new GoldmineGame({ seed, levels: this.options.levels }); }
  protected maxTicks(game: GoldmineGame) { return game.maxTicks; }
  protected override publishRecord(p: MinePlayer) {
    const record = { id: p.id, name: p.name, at: Date.now() };
    this.room.recordScore?.({ ...record, score: Math.max(p.game.money, p.game.peakMoney ?? 0) });
    this.room.recordScore?.({ ...record, score: p.game.level }, 'level');
  }

  protected scoreOf(game: GoldmineGame) { return game.money; }
  protected endOf(game: GoldmineGame): RaceEnd { return game.cleared ? 'finished' : 'dead'; }

  protected compare(a: MinePlayer, b: MinePlayer) {
    return b.game.money - a.game.money || b.game.level - a.game.level
      || Number(a.end === 'gaveUp') - Number(b.end === 'gaveUp') || b.game.tick - a.game.tick;
  }

  protected endMessage(p: MinePlayer) {
    if (p.game.cleared) return `🏆 ${p.name} qua hết ${p.game.levels} màn với ${p.game.money}$`;
    return `⛏️ ${p.name} dừng ở màn ${p.game.level} (cần ${p.game.goal}$, có ${p.game.money}$)`;
  }

  protected startMessage() {
    const who = this.seats.length > 1 ? `${this.seats.length} người cùng đua tiền` : 'chơi một mình';
    return `Ván ${this.gameNo}: ${this.options.levels} màn, mỗi màn 60 giây — ${who}. Chuẩn bị…`;
  }

  view(viewerId: string): GoldmineView {
    return this.raceView(viewerId, (p) => ({ mine: p.game.snapshot() }));
  }
}
