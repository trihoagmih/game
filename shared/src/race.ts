// Đua song song kiểu "client chơi, server phát lại" (Bay qua khe, Đào vàng).
// Mỗi người chơi một bản engine riêng cùng hạt giống. Engine tất định theo nhịp (tick) và danh sách
// lệnh [tick, lệnh]: client chạy thật để mượt, server phát lại đúng các lệnh đó để tự tính điểm.

import type { Identity } from './contracts.js';

/** Một lệnh của người chơi, áp dụng ngay trước bước `tick` → `tick + 1`. */
export type RaceInput<C extends string = string> = [tick: number, command: C];

/** Engine chạy theo nhịp cố định, không dùng đồng hồ hay số ngẫu nhiên ngoài hạt giống. */
export interface RaceEngine<C extends string> {
  readonly tick: number;
  readonly over: boolean;
  /** Trả về true nếu lệnh có tác dụng ở thời điểm này (client chỉ ghi lại lệnh được nhận). */
  command(command: C): boolean;
  step(): void;
}

/** Phát lại `inputs` (đã sắp theo tick) từ vị trí `from` tới `toTick`. Trả về số lệnh đã dùng. */
export function replayRace<C extends string>(game: RaceEngine<C>, inputs: readonly RaceInput<C>[], toTick: number, from = 0) {
  let used = from;
  while (!game.over && game.tick < toTick) {
    while (used < inputs.length && inputs[used][0] <= game.tick) game.command(inputs[used++][1]);
    game.step();
  }
  return used;
}

export type RaceStatus = 'waiting' | 'playing' | 'over';
/** Lý do một người dừng: rơi/thua màn, về đích, bỏ cuộc, hết giờ. */
export type RaceEnd = 'dead' | 'finished' | 'gaveUp' | 'timedOut';

export interface RacePlayerView extends Identity {
  score: number;
  tick: number;
  /** Số lệnh server đã nhận; client cắt nhật ký tới đây khi phải dựng lại trạng thái. */
  accepted: number;
  done: boolean;
  end: RaceEnd | null;
  endedAt: number | null;
}

export interface WorkspaceRecord extends Identity { score: number; at: number }

export interface RaceScore extends Identity { games: number; wins: number; best: number }

export interface RaceResult { winner: string | null; ranking: string[]; endedAt: number }

export interface RaceView<O extends object, P extends RacePlayerView> {
  options: O & { maxSeats: number };
  seats: Identity[];
  ready: string[];
  waitingFor: string[];
  status: RaceStatus;
  gameNo: number;
  myId: string | null;
  seed: number;
  tickMs: number;
  /** ms tới bước 0; âm nghĩa là ván đã chạy được chừng ấy. */
  startIn: number;
  players: P[];
  result: RaceResult | null;
  wins: RaceScore[];
  workspaceRecord?: WorkspaceRecord | null;
  workspaceLevelRecord?: WorkspaceRecord | null;
}
