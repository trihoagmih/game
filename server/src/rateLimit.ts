// Các bộ đếm giới hạn tần suất dùng chung.

/** Token bucket: hàm trả về false khi vượt giới hạn. `[sức chứa, số lượt hồi mỗi giây]`. */
export function tokenBucket([capacity, perSec]: readonly number[]) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * perSec);
    last = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

/**
 * Một token bucket cho mỗi khóa. Chỉ dùng với tập khóa hữu hạn do server kiểm soát
 * (vd. id sảnh từ cấu hình), vì bucket không bị dọn khỏi bộ nhớ.
 */
export function keyedTokenBucket(limits: readonly number[]) {
  const buckets = new Map<string, () => boolean>();
  return (key: string) => {
    let take = buckets.get(key);
    if (!take) {
      take = tokenBucket(limits);
      buckets.set(key, take);
    }
    return take();
  };
}

/**
 * Đếm số lần theo khóa (thường là IP) trong cửa sổ cố định tính từ lần đếm đầu tiên.
 * Tự dọn khóa hết hạn mỗi phút để bộ nhớ không tăng mãi.
 */
export class WindowCounter {
  declare windowMs: number;
  declare maxKeys: number;
  declare map: Map<string, {count: number; until: number}>;

  constructor(windowMs: number, maxKeys = Infinity) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.map = new Map(); // key -> { count, until }
    setInterval(() => this.sweep(), 60_000).unref();
  }

  count(key: string, now = Date.now()) {
    const r = this.map.get(key);
    if (!r) return 0;
    if (r.until < now) {
      this.map.delete(key);
      return 0;
    }
    return r.count;
  }

  /** Tăng bộ đếm, trả về giá trị mới. Bảng đầy thì trả về Infinity (coi như đã vượt giới hạn). */
  add(key: string, now = Date.now()) {
    const count = this.count(key, now);
    if (!count && this.map.size >= this.maxKeys) return Infinity;
    const r = this.map.get(key) || { count: 0, until: now + this.windowMs };
    r.count++;
    this.map.set(key, r);
    return r.count;
  }

  reset(key: string) { this.map.delete(key); }

  sweep(now = Date.now()) {
    for (const [key, r] of this.map) if (r.until < now) this.map.delete(key);
  }
}

/** Đếm số kết nối đồng thời theo khóa. */
export class ConnectionCounter {
  declare map: Map<string, number>;

  constructor() { this.map = new Map(); }
  get(key: string) { return this.map.get(key) || 0; }
  inc(key: string) { this.map.set(key, this.get(key) + 1); }
  dec(key: string) {
    const left = this.get(key) - 1;
    if (left > 0) this.map.set(key, left);
    else this.map.delete(key);
  }
}
