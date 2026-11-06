// Nối thú (kiểu "Pikachu" / Onet): chọn hai ô cùng hình, nối được bằng đường gấp khúc
// tối đa 3 đoạn thẳng (≤ 2 lần rẽ), đi qua ô trống hoặc vòng ra ngoài viền bàn.
// Bàn là mảng 2 chiều grid[r][c]: 0 = trống, 1..n = loại hình.

/** Số loại hình có sẵn (client vẽ bằng emoji, xem client/src/games/OnetGame.jsx). */
export const TILE_KINDS = 36;

/** Bộ sinh số ngẫu nhiên có hạt giống (mulberry32) để mọi người chơi cùng một bàn. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.state = () => a;
  return next;
}

const shuffleArr = (arr, rand) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const inside = (grid, r, c) => r >= 0 && c >= 0 && r < grid.length && c < grid[0].length;
const empty = (grid, r, c) => !inside(grid, r, c) || grid[r][c] === 0;

/**
 * Tạo bàn rows×cols (rows*cols phải chẵn). Mỗi loại hình xuất hiện số lần chẵn,
 * chia đều nhất có thể giữa `kinds` loại. Luôn có ít nhất một cặp nối được.
 */
export function createBoard(rows, cols, seed, kinds = TILE_KINDS) {
  if ((rows * cols) % 2) throw new Error('Số ô phải chẵn');
  const rand = rng(seed);
  const pairs = (rows * cols) / 2;
  const k = Math.min(kinds, pairs);
  // Chọn ngẫu nhiên k loại trong bộ hình để mỗi ván trông khác nhau
  const pick = shuffleArr(Array.from({ length: kinds }, (_, i) => i + 1), rand).slice(0, k);
  const tiles = [];
  for (let i = 0; i < pairs; i++) tiles.push(pick[i % k], pick[i % k]);
  shuffleArr(tiles, rand);
  const grid = Array.from({ length: rows }, (_, r) => tiles.slice(r * cols, (r + 1) * cols));
  return ensureMove(grid, rand);
}

const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/**
 * Tìm đường nối hai ô a=[r,c], b=[r,c] (cùng hình, khác ô).
 * Trả về các điểm gãy [[r,c], ...] từ a tới b (có thể nằm ngoài bàn: hàng -1/rows, cột -1/cols),
 * hoặc null nếu không nối được. Ưu tiên ít lần rẽ rồi đến đường ngắn.
 */
export function findPath(grid, a, b) {
  const rows = grid.length, cols = grid[0].length;
  const [ar, ac] = a, [br, bc] = b;
  if (!inside(grid, ar, ac) || !inside(grid, br, bc)) return null;
  if (ar === br && ac === bc) return null;
  const v = grid[ar][ac];
  if (!v || v !== grid[br][bc]) return null;
  // BFS theo số lần rẽ trên bàn có viền 1 ô bao quanh
  const W = cols + 2;
  const key = (r, c) => (r + 1) * W + (c + 1);
  const best = new Map(); // key*4+dir -> {turns, dist}
  const prev = new Map();
  let layer = [];
  for (let d = 0; d < 4; d++) layer.push({ r: ar, c: ac, d, turns: 0, dist: 0, from: null });
  let found = null;
  for (let turns = 0; turns <= 2 && !found; turns++) {
    const next = [];
    for (const s of layer) {
      const [dr, dc] = DIRS[s.d];
      let r = s.r + dr, c = s.c + dc, dist = s.dist;
      while (r >= -1 && c >= -1 && r <= rows && c <= cols) {
        dist++;
        if (r === br && c === bc) {
          if (!found || dist < found.dist) found = { r, c, d: s.d, dist, from: s };
          break;
        }
        if (!empty(grid, r, c)) break;
        const k = key(r, c) * 4 + s.d;
        const old = best.get(k);
        if (!old || old.turns > turns || (old.turns === turns && old.dist > dist)) {
          best.set(k, { turns, dist });
          const node = { r, c, turns, dist, from: s };
          prev.set(k, node);
          if (turns < 2) for (const nd of [(s.d + 1) % 4, (s.d + 3) % 4]) next.push({ ...node, d: nd, turns: turns + 1 });
        }
        r += dr; c += dc;
      }
    }
    layer = next;
  }
  if (!found) return null;
  // Dựng lại các điểm gãy: mỗi trạng thái bắt đầu một đoạn thẳng từ (r,c) của nó
  const pts = [[br, bc]];
  for (let s = found.from; s; s = s.from) {
    const last = pts[pts.length - 1];
    if (last[0] !== s.r || last[1] !== s.c) pts.push([s.r, s.c]);
  }
  return pts.reverse();
}

/** Một cặp nối được bất kỳ ([a, b]) hoặc null nếu bế tắc. */
export function findMove(grid) {
  const byKind = new Map();
  grid.forEach((row, r) => row.forEach((v, c) => {
    if (!v) return;
    if (!byKind.has(v)) byKind.set(v, []);
    byKind.get(v).push([r, c]);
  }));
  for (const cells of byKind.values()) {
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        if (findPath(grid, cells[i], cells[j])) return [cells[i], cells[j]];
      }
    }
  }
  return null;
}

export const remaining = (grid) => grid.reduce((n, row) => n + row.filter(Boolean).length, 0);

/** Xáo lại các hình còn lại (giữ nguyên vị trí ô trống). Trả về bàn mới. */
export function shuffleBoard(grid, rand) {
  const cells = [];
  const vals = [];
  grid.forEach((row, r) => row.forEach((v, c) => { if (v) { cells.push([r, c]); vals.push(v); } }));
  const g = grid.map((row) => row.slice());
  shuffleArr(vals, rand);
  cells.forEach(([r, c], i) => { g[r][c] = vals[i]; });
  return g;
}

/** Xáo cho tới khi có nước đi (bàn trống thì giữ nguyên). */
export function ensureMove(grid, rand) {
  let g = grid;
  for (let tries = 0; remaining(g) && !findMove(g) && tries < 200; tries++) g = shuffleBoard(g, rand);
  if (remaining(g) && !findMove(g)) g = forceAdjacentPair(g);
  return g;
}

/** Phòng xa khi xáo mãi không ra nước: đổi chỗ để có hai ô cùng hình nằm cạnh nhau. */
function forceAdjacentPair(grid) {
  const g = grid.map((row) => row.slice());
  for (let r = 0; r < g.length; r++) {
    for (let c = 0; c < g[0].length; c++) {
      const v = g[r][c];
      if (!v) continue;
      for (const [dr, dc] of DIRS) {
        const zr = r + dr, zc = c + dc;
        if (!inside(g, zr, zc) || !g[zr][zc] || g[zr][zc] === v) continue;
        for (let yr = 0; yr < g.length; yr++) {
          for (let yc = 0; yc < g[0].length; yc++) {
            if (g[yr][yc] === v && (yr !== r || yc !== c)) {
              [g[yr][yc], g[zr][zc]] = [g[zr][zc], g[yr][yc]];
              return g;
            }
          }
        }
      }
    }
  }
  return g;
}

/** Dồn các ô khác 0 của một dãy về đầu (toStart) hoặc cuối dãy. */
const compact = (line, toStart) => {
  const vals = line.filter(Boolean);
  const pad = Array(line.length - vals.length).fill(0);
  return toStart ? [...vals, ...pad] : [...pad, ...vals];
};

/**
 * Kiểu dồn hình sau mỗi lần nối (chế độ cổ điển: mỗi màn một kiểu, theo thứ tự này).
 * vin/hin: hai nửa dồn vào giữa; vout/hout: hai nửa tách ra hai mép.
 */
export const SHIFTS = ['none', 'down', 'left', 'up', 'right', 'vin', 'hin', 'vout', 'hout'];

/** Dồn các hình theo kiểu `dir` (xem SHIFTS). Trả về bàn mới. */
export function applyShift(grid, dir) {
  if (!dir || dir === 'none') return grid.map((row) => row.slice());
  const rows = grid.length, cols = grid[0].length;
  const g = grid.map((row) => row.slice());
  const halves = (n, toward) => (line) => {
    const m = Math.floor(n / 2);
    // vào giữa: nửa đầu dồn về cuối nửa, nửa sau dồn về đầu nửa; tách ra: ngược lại
    return [...compact(line.slice(0, m), !toward), ...compact(line.slice(m), toward)];
  };
  const fns = {
    down: (l) => compact(l, false), up: (l) => compact(l, true),
    right: (l) => compact(l, false), left: (l) => compact(l, true),
    vin: halves(rows, true), vout: halves(rows, false),
    hin: halves(cols, true), hout: halves(cols, false),
  };
  const f = fns[dir];
  if (!f) throw new Error('Kiểu dồn không hợp lệ');
  if (['down', 'up', 'vin', 'vout'].includes(dir)) {
    for (let c = 0; c < cols; c++) {
      const col = f(g.map((row) => row[c]));
      for (let r = 0; r < rows; r++) g[r][c] = col[r];
    }
  } else {
    for (let r = 0; r < rows; r++) g[r] = f(g[r]);
  }
  return g;
}

/** Trọng lực: các hình trong mỗi cột rơi xuống dưới, lấp ô trống. */
export const applyGravity = (grid) => applyShift(grid, 'down');

/**
 * Bàn của một người chơi. Mọi thay đổi qua match()/shuffle()/hint().
 * rand dùng cho xáo bàn (mỗi người một chuỗi riêng).
 */
export class OnetBoard {
  constructor(grid, { gravity = false, shift = gravity ? 'down' : 'none', rand = Math.random } = {}) {
    this.grid = grid.map((row) => row.slice());
    this.shift = shift;
    this.rand = rand;
    this.left = remaining(this.grid);
    this.pairs = 0;
    this.combo = 0;
    this.lastMatchAt = 0;
    this.score = 0;
  }

  /**
   * Nối a với b. Trả về { path, points, autoShuffled } hoặc ném lỗi.
   * Điểm: 10 mỗi cặp, cộng thêm combo nếu nối liên tiếp trong 3 giây.
   */
  match(a, b, now = Date.now()) {
    const path = findPath(this.grid, a, b);
    if (!path) throw new Error('Hai ô này không nối được');
    this.grid[a[0]][a[1]] = 0;
    this.grid[b[0]][b[1]] = 0;
    this.grid = applyShift(this.grid, this.shift);
    this.left -= 2;
    this.pairs++;
    this.combo = now - this.lastMatchAt <= 3000 ? this.combo + 1 : 1;
    this.lastMatchAt = now;
    const points = 10 + Math.min(this.combo - 1, 10) * 2;
    this.score += points;
    let autoShuffled = false;
    if (this.left && !findMove(this.grid)) {
      this.grid = ensureMove(this.grid, this.rand);
      autoShuffled = true;
    }
    return { path, points, autoShuffled };
  }

  /** Sang bàn mới (màn tiếp theo ở chế độ cổ điển): giữ điểm, đổi bàn và kiểu dồn. */
  load(grid, shift = 'none') {
    this.grid = grid.map((row) => row.slice());
    this.shift = shift;
    this.left = remaining(this.grid);
    this.combo = 0;
    this.lastMatchAt = 0;
  }

  shuffle() { this.grid = ensureMove(shuffleBoard(this.grid, this.rand), this.rand); }

  hint() { return findMove(this.grid); }

  get cleared() { return this.left === 0; }
}
