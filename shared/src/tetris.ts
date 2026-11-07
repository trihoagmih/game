export const WIDTH = 10;
export const HEIGHT = 20;
export const LINE_TARGET = { min: 1, max: 100, default: 20 };
export const INPUT_INTERVAL = 80;

// Các khối dùng khung vuông để xoay quanh tâm cố định.
export const SHAPES = {
  I: ['....', 'IIII', '....', '....'],
  J: ['J..', 'JJJ', '...'],
  L: ['..L', 'LLL', '...'],
  O: ['OO', 'OO'],
  S: ['.SS', 'SS.', '...'],
  T: ['.T.', 'TTT', '...'],
  Z: ['ZZ.', '.ZZ', '...'],
};

export type PieceKind = keyof typeof SHAPES;
export type TetrisInput = 'left' | 'right' | 'down' | 'clockwise' | 'counterclockwise' | 'drop';

export interface Piece {
  kind: PieceKind;
  x: number;
  y: number;
  rotation: number;
}

export interface TetrisBoardView {
  grid: string[];
  lines: number;
  piece: Piece | null;
  ghost: Piece | null;
  next: PieceKind | null;
}

export interface TetrisView {
  options: { targetLines: number };
  status: 'waiting' | 'playing' | 'over';
  seats: (import('./contracts.js').Identity | null)[];
  boards: (TetrisBoardView | null)[];
  ready: string[];
  waitingFor: string[];
  mySeat: number;
  round: string | null;
  startsAt: number | null;
  result: { winnerId: string | null; winnerName: string | null; reason: string } | null;
}

export function pieceCells({ kind, x = 0, y = 0, rotation = 0 }: Pick<Piece, 'kind'> & Partial<Piece>): [number, number][] {
  const shape = SHAPES[kind];
  const last = shape.length - 1;
  const cells: [number, number][] = [];
  for (let row = 0; row <= last; row++) {
    for (let col = 0; col <= last; col++) {
      if (shape[row][col] === '.') continue;
      const [dx, dy] = [[col, row], [last - row, col], [last - col, last - row], [row, last - col]][rotation];
      cells.push([x + dx, y + dy]);
    }
  }
  return cells;
}

const emptyRow = () => '.'.repeat(WIDTH);

export class TetrisBoard {
  grid = Array.from({ length: HEIGHT }, emptyRow);
  lines = 0;
  index = 0;
  toppedOut = false;
  piece: Piece | null = null;

  constructor(readonly pieces: readonly PieceKind[]) {
    this.spawn();
  }

  spawn() {
    const kind = this.pieces[this.index];
    this.piece = { kind, x: kind === 'O' ? 4 : 3, y: 0, rotation: 0 };
    this.toppedOut = !this.fits(this.piece);
    if (this.toppedOut) this.piece = null;
  }

  fits(piece: Piece) {
    return pieceCells(piece).every(([x, y]) => this.grid[y]?.[x] === '.');
  }

  move(dx: number, dy: number) {
    if (!this.piece) return false;
    const candidate = { ...this.piece, x: this.piece.x + dx, y: this.piece.y + dy };
    if (!this.fits(candidate)) return false;
    this.piece = candidate;
    return true;
  }

  rotate(direction: number) {
    if (!this.piece || this.piece.kind === 'O') return;
    const rotation = (this.piece.rotation + direction + 4) % 4;
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [0, -2]]) {
      const candidate = { ...this.piece, x: this.piece.x + dx, y: this.piece.y + dy, rotation };
      if (!this.fits(candidate)) continue;
      this.piece = candidate;
      return;
    }
  }

  landing() {
    let candidate = this.piece;
    while (candidate && this.fits({ ...candidate, y: candidate.y + 1 })) {
      candidate = { ...candidate, y: candidate.y + 1 };
    }
    return candidate;
  }

  drop() {
    this.piece = this.landing();
    this.lock();
  }

  fall() {
    if (this.piece && !this.move(0, 1)) this.lock();
  }

  lock() {
    const piece = this.piece;
    if (!piece) return;
    for (const [x, y] of pieceCells(piece)) {
      const row = this.grid[y];
      this.grid[y] = row.slice(0, x) + piece.kind + row.slice(x + 1);
    }
    const remaining = this.grid.filter((row) => row.includes('.'));
    const cleared = HEIGHT - remaining.length;
    this.lines += cleared;
    this.grid = [...Array.from({ length: cleared }, emptyRow), ...remaining];
    this.index++;
    this.spawn();
  }

  view(): TetrisBoardView {
    return {
      grid: this.grid,
      lines: this.lines,
      piece: this.piece,
      ghost: this.piece ? this.landing() : null,
      next: this.piece ? this.pieces[this.index + 1] : null,
    };
  }
}
