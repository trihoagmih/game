// Líu lưỡi: hai đội thay phiên, mỗi lượt một người đọc to câu líu lưỡi hiện trên màn hình
// (qua kênh thoại hoặc ngồi cạnh nhau). Những người còn lại chấm "Chuẩn" hay "Vấp";
// đọc chuẩn được cộng điểm theo độ khó của câu cho đội mình.
import type { Identity } from './contracts.js';

export const TEAM_COUNT = 2;
export const TEAM_NAMES = ['Đội Lúa Nếp', 'Đội Bưởi Chua'] as const;
export type TeamIndex = 0 | 1;

export const MIN_PLAYERS = 2;
export const MAX_SEATS = { min: 2, max: 12, default: 8 };
export const ROUNDS = { min: 1, max: 5, default: 2 };
export const READ_SECONDS = { min: 10, max: 45, default: 20 };
export const JUDGE_SECONDS = 12;
export const RESULT_SECONDS = 4;

export type TwisterLevel = 1 | 2 | 3;
export const LEVEL_NAMES: Record<TwisterLevel, string> = { 1: 'Khởi động', 2: 'Khó', 3: 'Siêu khó' };
export type TwisterDifficulty = 'mix' | 'easy' | 'hard';
export const DIFFICULTIES: [TwisterDifficulty, string][] = [
  ['mix', 'Tăng dần — khởi động rồi khó dần'],
  ['easy', 'Nhẹ nhàng — chỉ câu khởi động'],
  ['hard', 'Hiểm hóc — chỉ câu khó và siêu khó'],
];

/** Một câu líu lưỡi; `x` là số lần phải đọc liền một hơi (mặc định 1). */
export interface TwisterLine { t: string; l: TwisterLevel; x?: number }
export type Verdict = 'clean' | 'slip';
export type TwisterPhase = 'read' | 'judge' | 'result';
/** Kết quả một lượt: `skip` là người đọc bỏ qua hoặc rời bàn. */
export type TurnOutcome = Verdict | 'skip';

export const isTeam = (v: unknown): v is TeamIndex => v === 0 || v === 1;
export const isVerdict = (v: unknown): v is Verdict => v === 'clean' || v === 'slip';
export const isDifficulty = (v: unknown): v is TwisterDifficulty => v === 'mix' || v === 'easy' || v === 'hard';

/** Kiểm tra bộ câu đọc từ tệp dữ liệu; câu sai định dạng là lỗi lúc khởi động server. */
export function parseBank(raw: unknown): TwisterLine[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Bộ câu líu lưỡi rỗng');
  return raw.map((item: unknown, i) => {
    if (typeof item !== 'object' || item === null) throw new Error(`Câu ${i + 1} không hợp lệ`);
    const { t, l, x } = item as Record<string, unknown>;
    if (typeof t !== 'string' || !t.trim()) throw new Error(`Câu ${i + 1} thiếu nội dung`);
    if (l !== 1 && l !== 2 && l !== 3) throw new Error(`Câu ${i + 1} có độ khó lạ`);
    if (x !== undefined && (!Number.isInteger(x) || Number(x) < 1 || Number(x) > 5)) throw new Error(`Câu ${i + 1} có số lần đọc lạ`);
    return x === undefined ? { t: t.trim(), l } : { t: t.trim(), l, x: Number(x) };
  });
}

/** Độ khó của lượt `turn` (0-based) trong `total` lượt: "tăng dần" chia ba chặng. */
export function levelFor(difficulty: TwisterDifficulty, turn: number, total: number): TwisterLevel {
  if (difficulty === 'easy') return 1;
  if (difficulty === 'hard') return turn % 3 === 2 ? 2 : 3;
  const part = total > 0 ? turn / total : 0;
  return part < 1 / 3 ? 1 : part < 2 / 3 ? 2 : 3;
}

/** Điểm khi đọc chuẩn: bằng độ khó của câu. */
export const pointsFor = (level: TwisterLevel) => level;

/** Số lượt mỗi đội: mỗi người của đội đông nhất đọc `rounds` câu; đội ít người hơn đọc xoay vòng. */
export const turnsPerTeam = (rounds: number, sizes: number[]) => rounds * Math.max(1, ...sizes);

/** Đội đọc ở lượt `turn`: hai đội thay phiên, đội `first` mở màn. */
export const teamAt = (turn: number, first: TeamIndex): TeamIndex => ((turn + first) % TEAM_COUNT === 0 ? 0 : 1);

/** Đội ít người hơn (bằng nhau thì đội đầu) — chỗ ngồi mặc định cho người mới vào bàn. */
export function smallerTeam(teams: TeamIndex[]): TeamIndex {
  const count = (t: TeamIndex) => teams.filter((x) => x === t).length;
  return count(1) < count(0) ? 1 : 0;
}

/**
 * Chấm một lượt từ phiếu của người nghe: đọc chuẩn khi số phiếu "Chuẩn" không ít hơn "Vấp".
 * Không ai chấm thì coi như không ai bắt được lỗi.
 */
export function tally(votes: Iterable<Verdict>) {
  let clean = 0;
  let slip = 0;
  for (const v of votes) if (v === 'clean') clean++; else slip++;
  return { clean, slip, verdict: (clean >= slip ? 'clean' : 'slip') as Verdict };
}

/**
 * Chọn câu cho độ khó `level`, tránh các câu đã dùng (`used`) cho tới khi hết câu cùng độ khó.
 * `rand(n)` trả về số nguyên ngẫu nhiên trong [0, n).
 */
export function pickLine(bank: TwisterLine[], level: TwisterLevel, used: ReadonlySet<number>, rand: (n: number) => number) {
  const same = bank.map((line, i) => ({ line, i })).filter((x) => x.line.l === level);
  const pool = same.length ? same : bank.map((line, i) => ({ line, i }));
  const fresh = pool.filter((x) => !used.has(x.i));
  const from = fresh.length ? fresh : pool;
  return from[rand(from.length)].i;
}

// ---------- View gửi xuống client ----------

export interface TwisterSeatView extends Identity { team: TeamIndex }
export interface TwisterPlayerView extends TwisterSeatView { gone: boolean; reads: number; clean: number }
export interface TwisterTurnView {
  no: number;
  readerId: string;
  readerName: string;
  team: TeamIndex;
  text: string;
  level: TwisterLevel;
  repeat: number;
  outcome: TurnOutcome;
  clean: number;
  slip: number;
  points: number;
}
export interface TwisterCurrentView {
  phase: TwisterPhase;
  readerId: string;
  team: TeamIndex;
  text: string;
  level: TwisterLevel;
  repeat: number;
  /** Ai đã chấm (không lộ chấm gì cho tới khi có kết quả). */
  voted: string[];
  voters: number;
  myVote: Verdict | null;
  canVote: boolean;
  outcome: TwisterTurnView | null;
}
export interface TwisterView {
  options: { maxSeats: number; rounds: number; readSeconds: number; difficulty: TwisterDifficulty };
  status: 'waiting' | 'playing' | 'over';
  seats: TwisterSeatView[];
  ready: string[];
  waitingFor: string[];
  minPlayers: number;
  myId: string | null;
  gameNo: number;
  players: TwisterPlayerView[];
  turn: number;
  totalTurns: number;
  turnNo: number;
  current: TwisterCurrentView | null;
  phaseLeft: number;
  phaseTotal: number;
  scores: [number, number];
  log: TwisterTurnView[];
  result: { winner: TeamIndex | null; scores: [number, number]; reason: 'done' | 'forfeit' | 'stopped' } | null;
  wins: [number, number];
  bankSize: number;
}
