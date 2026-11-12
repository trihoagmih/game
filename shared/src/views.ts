/**
 * Phần trạng thái phòng mà server gửi cho từng người xem (`RoomState.state`), theo từng trò.
 * Server khai báo `view(): XView` để kiểu này luôn khớp với dữ liệu thật; client chỉ đọc.
 * Không đặt đáp án, bài tẩy của người khác hay dữ liệu riêng tư vào đây.
 */
import type { Identity } from './contracts.js';
import type { Marks } from './wordguess.js';
import type { DrawOp } from './scribble.js';
import type { PokerGame } from './poker.js';
import type { TalaGame } from './tala.js';
import type { SamLocGame } from './samloc.js';
import type { Cell, findMove, OnetBoard } from './onet.js';
import type { WordChainResult } from './wordchain.js';
import type { SnakeView } from './snake.js';
import type { TetrisView } from './tetris.js';
import type { TwisterView } from './twister.js';
import type { SkyhopView } from './skyhop.js';
import type { ChickenView } from './chicken.js';
import type { GoldmineView } from './goldmine.js';

// ---------- Phần dùng chung ----------

export interface ReadyView { ready: string[]; waitingFor: string[] }
/** Ghế ngồi: người thật hoặc máy (`bot` là cấp độ máy). */
export interface SeatView extends Identity { bot?: string }

/** Cam kết bộ bài: khi đang chơi chỉ có commit, xong ván mới lộ các lá được phép thấy. */
export type FairnessView =
  | { no: number; commit: string }
  | { no: number; commit: string; leaves: string[]; cards: { i: number; card: string; salt: string }[]; total: number }
  | null;

export interface ScoreRowView extends Identity { points: number; games: number; wins: number; draws: number; losses: number }
export interface MatchResultView {
  no: number; ts: number; players: (Identity & { side: string })[]; winnerId: string | null; reason: string; moves: number;
}
export interface ScoreboardView { rows: ScoreRowView[]; history: MatchResultView[]; gameNo: number }

// ---------- Cờ đối kháng có đồng hồ ----------

export interface DuelRequestView { type: 'draw' | 'undo'; from: string }
export interface DuelResultView { winner: string | null; winnerName: string | null; reason: string; text: string; line?: number[] }
export interface DuelView<O> {
  options: O;
  seats: Record<string, SeatView | null>;
  /** Bên nào đã sẵn sàng (chủ phòng không cần bấm). */
  ready: Record<string, boolean>;
  waitingFor: string[];
  status: string;
  clocks: Record<string, number>;
  running: boolean;
  pending: DuelRequestView | null;
  result: DuelResultView | null;
  myColor: string | null;
  score: ScoreboardView;
}

export interface XiangqiBoardView {
  board: string[]; turn: string;
  moves: { san: string; from: number; to: number; captured: string | null }[];
  lastMove: { from: number; to: number } | null;
  inCheck: boolean;
}
export type XiangqiView = DuelView<{ minutes: number }> & XiangqiBoardView;

export interface CaroBoardView {
  size: number; board: string[]; turn: string;
  moves: { cell: number; p: string; san: string }[];
  lastMove: number | null;
}
export type CaroView = DuelView<{ minutes: number; size: number; blockTwoEnds: boolean }> & CaroBoardView;

export type ChessColor = 'w' | 'b';
export interface ChessMoveView {
  san: string; from: number; to: number; piece: string; captured: string | null;
  promotion: string | null; check: boolean; checkmate: boolean;
}
export interface ChessView {
  options: { minutes: number };
  seats: Record<ChessColor, Identity | null>;
  ready: Record<ChessColor, boolean>;
  rematch: Record<ChessColor, boolean>;
  status: string;
  board: string[];
  turn: string;
  moves: ChessMoveView[];
  lastMove: { from: number; to: number } | null;
  inCheck: boolean;
  clocks: Record<string, number>;
  running: boolean;
  pending: { type: 'draw' | 'undo'; from: ChessColor } | null;
  result: { winner: string | null; reason: string; text: string } | null;
  myColor: ChessColor | null;
  score: ScoreboardView;
}

// ---------- Bài ----------

export interface PokerConfig {
  bigBlind: number; smallBlind: number; buyIn: number; maxSeats: number; turnSeconds: number; rabbitHunt: boolean;
}
export type PokerTableView = ReturnType<PokerGame['view']>;
export type PokerView = PokerTableView & ReadyView & {
  fair: FairnessView;
  handLogCount: number;
  handLogLast: number;
  config: PokerConfig;
  turnLeft: number;
  turnTotal: number;
  nextHandIn: number;
  started: boolean;
};
export type PokerHandLog = ReturnType<PokerGame['historyView']>;

export interface CardTableConfig { maxSeats: number; unit: number; turnSeconds: number }
export interface CardSeatView extends Identity { total: number; left: boolean; online: boolean }
export interface CardTableView<G> extends ReadyView {
  fair: FairnessView;
  config: CardTableConfig;
  seats: (CardSeatView | null)[];
  gameSeats: number[];
  game: G | null;
  playing: boolean;
  turnLeft: number;
  turnTotal: number;
  mySeat: number;
  gameNo: number;
}
export type TalaGameView = ReturnType<TalaGame['view']>;
export type TalaView = CardTableView<TalaGameView>;
export type SamLocGameView = ReturnType<SamLocGame['view']>;
export type SamLocView = CardTableView<SamLocGameView>;

// ---------- Nối thú ----------

export interface OnetConfig {
  mode: 'classic' | 'race'; maxSeats: number; rows: number; cols: number;
  minutes: number; hints: number; shuffles: number; gravity: boolean;
}
type OnetMatch = ReturnType<OnetBoard['match']>;
export interface OnetLastMatch {
  seq: number; path: OnetMatch['path']; cells: Cell[]; points: OnetMatch['points']; combo: number; autoShuffled: OnetMatch['autoShuffled'];
}
export interface OnetPlayerView extends Identity {
  grid: number[][]; left: number; pairs: number; score: number; combo: number;
  done: boolean; gaveUp: boolean; finishedAt: number | null; bonus: number; level: number; shift: string; timedOut: boolean;
  /** Chỉ có ở chế độ cổ điển khi đang chơi. */
  timeLeft?: number;
  seq: number;
  last: OnetLastMatch | null;
  /** Gợi ý và lượt còn lại: chỉ người đó thấy. */
  hint?: ReturnType<typeof findMove> | null;
  hintsLeft?: number;
  shufflesLeft?: number;
}
export interface OnetScoreView extends Identity { games: number; wins: number; best: number; clears: number }
export interface OnetView extends ReadyView {
  options: OnetConfig;
  seats: Identity[];
  status: string;
  gameNo: number;
  myId: string | null;
  timeLeft: number;
  timeTotal: number;
  levels: number;
  players: OnetPlayerView[];
  result: { winner: string | null; ranking: string[]; endedAt: number } | null;
  wins: OnetScoreView[];
}

// ---------- Đố vui ----------

export interface QuizConfig { maxSeats: number; questions: number; seconds: number; category: string }
export interface QuizLastAnswer { answered: boolean; choice: number | null; correct: boolean; points: number; bonus: number; ms: number | null }
export interface QuizGameView {
  title: string;
  index: number;
  total: number;
  phase: 'intro' | 'question' | 'reveal' | 'over';
  timeLeft: number;
  totalMs: number;
  question: { q: string; c: string | null; choices: string[] } | null;
  answered: number;
  players: number;
  myChoice: number | null;
  reveal: { answer: number; counts: number[] } | null;
  me: { score: number; streak: number; correct: number; last: QuizLastAnswer | null } | null;
  leaderboard: (Identity & { score: number; streak: number; correct: number; left: boolean; gained: number | null })[];
}
export interface QuizScoreView extends Identity { games: number; wins: number; best: number }
export interface QuizHistoryView {
  no: number; endedAt: number; title: string; total: number;
  ranking: (Identity & { score: number; correct: number })[];
}
export interface QuizView extends ReadyView {
  options: QuizConfig;
  categories: string[];
  bankSize: number;
  seats: Identity[];
  status: string;
  gameNo: number;
  myId: string | null;
  source: { type: 'custom'; title: string; count: number; by: string } | { type: 'builtin'; category: string };
  game: QuizGameView | null;
  wins: QuizScoreView[];
  history: QuizHistoryView[];
}

// ---------- Đoán chữ ----------

export interface WordGuessConfig { mode: 'coop' | 'race'; maxSeats: number; minutes: number; daily: boolean; strict: boolean }
/** Bàn của người khác trong lúc đua chỉ có màu ô (không có chữ). */
export type GuessView = { text: string; marks: Marks[]; name: string } | { marks: Marks[]; text?: undefined; name?: undefined };
export interface GuessBoardView extends Identity {
  done: boolean; solved: boolean; left: boolean; gaveUp: boolean; count: number; guesses: GuessView[];
}
export type WordGuessResult =
  | { reason: string; solved: boolean; solvedBy: string | null; guesses: number }
  | { reason: string; winner: string | null; ranking: string[] };
export interface WordGuessGameView {
  mode: WordGuessConfig['mode'];
  daily: boolean;
  timeLeft: number;
  totalMs: number;
  maxGuesses: number;
  /** Chỉ lộ khi ván đã xong. */
  secret: string | null;
  result: WordGuessResult | null;
  shared: GuessBoardView | null;
  mine: GuessBoardView | null;
  others: GuessBoardView[];
}
export interface WordGuessScoreView extends Identity { games: number; wins: number; solved: number }
export interface WordGuessHistoryView {
  no: number; endedAt: number; secret: string; mode: WordGuessConfig['mode']; solved: boolean;
  ranking: (Identity & { guesses: number; solved: boolean })[];
}
export interface WordGuessView extends ReadyView {
  options: WordGuessConfig;
  seats: Identity[];
  status: string;
  gameNo: number;
  myId: string | null;
  answers: number;
  game: WordGuessGameView | null;
  wins: WordGuessScoreView[];
  history: WordGuessHistoryView[];
}

// ---------- Nối từ ----------

export interface WordChainConfig { maxSeats: number; turnSeconds: number; lives: number; dictionary: boolean; strict: boolean }
export interface WordChainSeatView extends Identity { bot?: string | null }
export interface WordChainGameView {
  players: (Identity & { bot: string | null; lives: number; out: boolean; words: number })[];
  currentId: string | null;
  required: string | null;
  chain: { text: string; syllables: string[]; by: string; name: string; ts: number; known: boolean | null }[];
  total: number;
  objections: string[];
  objectionsNeeded: number;
  result: WordChainResult | null;
}
export interface WordChainScoreView extends Identity { games: number; wins: number }
export interface WordChainHistoryView {
  no: number; endedAt: number; players: Identity[]; winner: string | null; ranking: string[];
  words: { s: string[]; by: string; known: boolean | null }[];
}
export interface WordChainView extends ReadyView {
  options: WordChainConfig;
  seats: WordChainSeatView[];
  firstMinNext: number;
  status: string;
  gameNo: number;
  myId: string | null;
  turnLeft: number;
  turnTotal: number;
  game: WordChainGameView | null;
  wins: WordChainScoreView[];
  history: WordChainHistoryView[];
}

// ---------- Vẽ đoán ----------

export interface ScribbleConfig { maxSeats: number; rounds: number; drawSeconds: number; hints: boolean; customCount: number; onlyCustom: boolean }
export interface ScribbleScoreView extends Identity { score: number }
export interface ScribbleFeedView { kind: 'sys' | 'correct' | 'guess' | 'close'; text: string; id?: string; name?: string; n: number }
export interface ScribbleView extends ReadyView {
  options: ScribbleConfig;
  seats: Identity[];
  status: string;
  gameNo: number;
  myId: string | null;
  round: number;
  phase: 'choose' | 'draw' | 'reveal' | null;
  turnNo: number;
  drawerId: string | null;
  choices: string[] | null;
  /** Chỉ người vẽ, người đã đoán đúng hoặc lúc xem đáp án mới thấy. */
  word: string | null;
  mask: string | null;
  phaseLeft: number;
  phaseTotal: number;
  guessed: string[];
  turnGains: { drawer: number; guessers: Record<string, number> } | null;
  scores: ScribbleScoreView[];
  order: string[];
  feed: ScribbleFeedView[];
  last: { no: number; ranking: ScribbleScoreView[]; winners: string[] } | null;
  wins: (Identity & { games: number; wins: number })[];
}

// ---------- Tam sao thất bản ----------

export type TelephoneKind = 'text' | 'draw';
export interface TelephoneConfig { mode: 'relay' | 'classic'; maxSeats: number; writeSeconds: number; drawSeconds: number; suggest: boolean }
export interface ChainEntryView { by: string | null; name: string; kind: TelephoneKind; text?: string; drawId?: string }
export interface TelephoneTaskView {
  kind: TelephoneKind;
  /** Đề bài từ người trước — không có tên để khỏi đoán theo người. */
  prev: { kind: 'text'; text?: string; drawId?: undefined } | { kind: 'draw'; drawId?: string; text?: undefined } | null;
  done: boolean;
  text: string;
  suggestions: string[] | null | undefined;
}
export interface TelephoneView extends ReadyView {
  options: TelephoneConfig;
  seats: Identity[];
  minPlayers: number;
  status: string;
  gameNo: number;
  myId: string | null;
  players: (Identity & { gone: boolean; done: boolean })[];
  step: number;
  activeId: string | null;
  steps: number;
  kind: TelephoneKind | null;
  turnNo: number;
  phaseLeft: number;
  phaseTotal: number;
  task: TelephoneTaskView | null;
  albums: { owner: string; entries: ChainEntryView[] }[] | null;
  reveal: { album: number; shown: number } | null;
}

// ---------- Tra cứu theo trò ----------

export interface GameViews {
  chess: ChessView;
  xiangqi: XiangqiView;
  poker: PokerView;
  tala: TalaView;
  caro: CaroView;
  samloc: SamLocView;
  wordchain: WordChainView;
  quiz: QuizView;
  wordguess: WordGuessView;
  scribble: ScribbleView;
  telephone: TelephoneView;
  onet: OnetView;
  snake: SnakeView;
  tetris: TetrisView;
  twister: TwisterView;
  skyhop: SkyhopView;
  goldmine: GoldmineView;
  chicken: ChickenView;
}
export type GameKind = keyof GameViews;

/** Dữ liệu lớn lấy theo yêu cầu qua `game:query`, theo loại truy vấn. */
export interface QueryResults {
  canvas: { turn: number; ops: DrawOp[] };
  drawing: { id: string; ops: DrawOp[] };
  handLog: PokerHandLog;
}
