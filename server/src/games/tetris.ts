import { randomInt, randomUUID } from 'node:crypto';
import { INPUT_INTERVAL, LINE_TARGET, SHAPES, TetrisBoard } from '@game/shared/tetris';
import type { PieceKind, TetrisInput, TetrisView } from '@game/shared/tetris';
import type { GameAction, Identity } from '@game/shared/contracts';
import type { Room } from '../lobby.js';
import type { GameHandler } from './types.js';
import { ReadyGate } from './ready.js';

const GRAVITY_MS = 750;
const COUNTDOWN_MS = 3000;
const INPUTS = new Map<TetrisInput, (board: TetrisBoard) => void>([
  ['left', (board) => board.move(-1, 0)],
  ['right', (board) => board.move(1, 0)],
  ['down', (board) => board.move(0, 1)],
  ['clockwise', (board) => board.rotate(1)],
  ['counterclockwise', (board) => board.rotate(-1)],
  ['drop', (board) => board.drop()],
]);

export class TetrisHandler implements GameHandler {
  readonly maxPlayers = 2;
  readonly options: TetrisView['options'];
  seats: TetrisView['seats'] = [null, null];
  boards: (TetrisBoard | null)[] = [null, null];
  readonly ready: ReadyGate;
  status: TetrisView['status'] = 'waiting';
  round: string | null = null;
  startsAt: number | null = null;
  nextFallAt = 0;
  result: TetrisView['result'] = null;
  timer: NodeJS.Timeout | null = null;
  pieces: PieceKind[] = [];
  lastInput = [-Infinity, -Infinity];

  constructor(public room: Pick<Room, 'ownerId' | 'isOnline' | 'changed' | 'system'>, options: Record<string, unknown>) {
    const rawTarget = options.targetLines ?? LINE_TARGET.default;
    const targetLines = typeof rawTarget === 'number' || typeof rawTarget === 'string' ? Number(rawTarget) : NaN;
    if (!Number.isInteger(targetLines) || targetLines < LINE_TARGET.min || targetLines > LINE_TARGET.max) {
      throw new Error(`Số hàng mục tiêu phải là số nguyên từ ${LINE_TARGET.min} đến ${LINE_TARGET.max}`);
    }
    this.options = { targetLines };
    this.ready = new ReadyGate(room);
  }

  // Both boards refer to this array, including after snapshot recovery.
  extendPieces(index: number) {
    while (this.pieces.length <= index) {
      const bag = Object.keys(SHAPES) as PieceKind[];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.pieces.push(...bag);
    }
  }

  seatOf(id: string) { return this.seats.findIndex((seat) => seat?.id === id); }
  playerIds() { return this.seats.flatMap((seat) => seat ? [seat.id] : []); }
  isPlaying() { return this.status === 'playing'; }

  sit(user: Identity) {
    if (this.seatOf(user.id) !== -1) return;
    const index = this.seats.indexOf(null);
    if (index === -1) throw new Error('Bàn đã đủ 2 người');
    this.seats[index] = { id: user.id, name: user.name };
    this.boards[index] = null;
  }

  stand(id: string) {
    const index = this.seatOf(id);
    if (index === -1) return;
    if (this.isPlaying()) this.finish(1 - index, 'Đối thủ rời bàn');
    this.seats[index] = null;
    this.boards[index] = null;
    this.ready.clear();
    if (!this.seats.some(Boolean)) {
      this.status = 'waiting';
      this.result = null;
    }
  }

  onLeave(id: string) { this.stand(id); }

  rename(id: string, name: string) {
    const index = this.seatOf(id);
    const seat = this.seats[index];
    if (seat) seat.name = name;
    if (this.result?.winnerId === id) this.result.winnerName = name;
  }

  start() {
    this.pieces = [];
    this.extendPieces(1);
    this.boards = this.seats.map(() => new TetrisBoard(this.pieces));
    this.ready.clear();
    this.lastInput = [-Infinity, -Infinity];
    this.round = randomUUID();
    this.startsAt = Date.now() + COUNTDOWN_MS;
    this.result = null;
    this.status = 'playing';
    this.room.system(`Bắt đầu đua xóa ${this.options.targetLines} hàng`);
    this.nextFallAt = this.startsAt + GRAVITY_MS;
    this.schedule();
  }

  schedule() {
    this.timer = setTimeout(() => {
      const now = Date.now();
      while (this.isPlaying() && this.nextFallAt <= now) {
        for (const board of this.boards) {
          if (!board) continue;
          this.extendPieces(board.index + 2);
          board.fall();
        }
        this.nextFallAt += GRAVITY_MS;
        this.checkResult();
      }
      this.room.changed();
      if (this.isPlaying()) this.schedule();
    }, Math.max(0, this.nextFallAt - Date.now()));
    this.timer.unref();
  }

  finish(winner: number | null, reason: string) {
    this.dispose();
    this.status = 'over';
    const seat = winner === null ? null : this.seats[winner];
    this.result = { winnerId: seat?.id ?? null, winnerName: seat?.name ?? null, reason };
    this.room.system(`${seat ? `${seat.name} thắng` : 'Hòa'} — ${reason}`);
  }

  checkResult() {
    const reached = this.boards.map((board) => !!board && board.lines >= this.options.targetLines);
    if (reached.some(Boolean)) {
      this.finish(reached.every(Boolean) ? null : reached.indexOf(true), `Đã xóa đủ ${this.options.targetLines} hàng`);
      return;
    }
    const toppedOut = this.boards.map((board) => board?.toppedOut ?? false);
    if (toppedOut.some(Boolean)) {
      this.finish(toppedOut.every(Boolean) ? null : toppedOut.indexOf(false),
        toppedOut.every(Boolean) ? 'Cả hai bàn đều đầy' : 'Bàn đối thủ đã đầy');
    }
  }

  action(id: string, action: GameAction) {
    if (action.type === 'start') {
      if (this.isPlaying()) throw new Error('Ván đang diễn ra');
      this.ready.check(id, this.seats.filter((seat) => seat !== null));
      if (!this.playerIds().every((id) => this.room.isOnline(id))) throw new Error('Cần hai người chơi đang kết nối');
      this.start();
      return;
    }
    const index = this.seatOf(id);
    if (index === -1) throw new Error('Bạn đang ở chế độ xem');
    if (action.type === 'ready') {
      if (this.isPlaying()) throw new Error('Ván đang diễn ra');
      this.ready.toggle(id);
      return;
    }
    if (action.type !== 'tetrisInput' || typeof action.round !== 'string') throw new Error('Hành động không hợp lệ');
    const apply = INPUTS.get(action.input);
    if (!apply) throw new Error('Hành động không hợp lệ');
    const now = Date.now();
    if (!this.isPlaying() || action.round !== this.round || now < (this.startsAt ?? Infinity)) return;
    const board = this.boards[index];
    if (!board || now - this.lastInput[index] < INPUT_INTERVAL) return;
    this.lastInput[index] = now;
    this.extendPieces(board.index + 2);
    apply(board);
    this.checkResult();
  }

  view(id: string): TetrisView {
    return {
      options: this.options,
      status: this.status,
      seats: this.seats,
      boards: this.boards.map((board) => board?.view() ?? null),
      ...this.ready.view(this.playerIds()),
      mySeat: this.seatOf(id),
      round: this.round,
      startsAt: this.startsAt,
      result: this.result,
    };
  }

  dispose() {
    clearTimeout(this.timer ?? undefined);
    this.timer = null;
  }
}
