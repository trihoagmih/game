import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WorkspaceRecord } from '@game/shared/race';

export interface RecordBackend {
  read(key: string): Promise<WorkspaceRecord | null>;
  update(key: string, record: WorkspaceRecord): Promise<WorkspaceRecord>;
}

/** Cache theo workspace/game; backend chịu trách nhiệm cập nhật max nguyên tử. */
export class WorkspaceRecords {
  private cache = new Map<string, WorkspaceRecord>();
  private refreshed = new Map<string, number>();
  private pending = new Set<string>();

  constructor(private backend?: RecordBackend, private changed: () => void = () => {}) {}

  key(server: string, game: string) { return JSON.stringify([server, game]); }

  get(server: string, game: string) {
    const key = this.key(server, game);
    if (this.backend && !this.pending.has(key) && Date.now() - (this.refreshed.get(key) ?? 0) > 2000) {
      this.pending.add(key);
      void this.backend.read(key).then((record) => {
        if (record) this.remember(key, record);
        this.refreshed.set(key, Date.now());
      }).catch(() => console.error('[workspace-records] read failed')).finally(() => this.pending.delete(key));
    }
    return this.cache.get(key) ?? null;
  }

  refresh() {
    for (const key of this.refreshed.keys()) {
      const scope: unknown = JSON.parse(key);
      if (Array.isArray(scope) && typeof scope[0] === 'string' && typeof scope[1] === 'string') this.get(scope[0], scope[1]);
    }
  }

  private remember(key: string, record: WorkspaceRecord) {
    if (record.score <= (this.cache.get(key)?.score ?? 0)) return;
    this.cache.set(key, record);
    this.changed();
  }

  async submit(server: string, game: string, record: WorkspaceRecord) {
    if (!Number.isSafeInteger(record.score) || record.score <= 0) return;
    const key = this.key(server, game);
    // Persist trước khi công bố, không hiển thị một kỷ lục chưa được lưu.
    const saved = this.backend ? await this.backend.update(key, record) : record;
    this.remember(key, saved);
  }
}

/** Single-process deployment: một file riêng, không phụ thuộc vòng đời phòng. */
export class FileRecordBackend implements RecordBackend {
  private records = new Map<string, WorkspaceRecord>();
  private writes: Promise<void> = Promise.resolve();

  constructor(private path: string) {}

  async load() {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Invalid workspace records');
      for (const entry of parsed) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isRecord(entry[1])) throw new Error('Invalid workspace record');
        this.records.set(entry[0], entry[1]);
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }

  async read(key: string) { return this.records.get(key) ?? null; }

  async update(key: string, record: WorkspaceRecord) {
    const write = this.writes.then(async () => {
      if (record.score <= (this.records.get(key)?.score ?? 0)) return;
      const next = new Map(this.records).set(key, record);
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path + '.tmp', JSON.stringify([...next]), { mode: 0o600 });
      await rename(this.path + '.tmp', this.path);
      this.records = next;
    });
    this.writes = write.catch(() => {});
    await write;
    return this.records.get(key) ?? record;
  }
}

export function isRecord(value: unknown): value is WorkspaceRecord {
  if (!value || typeof value !== 'object') return false;
  return 'id' in value && typeof value.id === 'string' && 'name' in value && typeof value.name === 'string'
    && 'score' in value && typeof value.score === 'number' && Number.isSafeInteger(value.score) && value.score > 0
    && 'at' in value && typeof value.at === 'number' && Number.isFinite(value.at);
}

/** Redis Lua giữ max khi nhiều shard đồng thời hoàn tất ván. Không đặt TTL. */
export class RedisRecordBackend implements RecordBackend {
  constructor(private client: Pick<import('./cluster.js').Cluster['client'], 'get' | 'eval'>, private prefix: string) {}
  private key(key: string) { return this.prefix + ':workspace-record:' + key; }
  async read(key: string) {
    const raw = await this.client.get(this.key(key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('Invalid workspace record');
    return parsed;
  }
  async update(key: string, record: WorkspaceRecord) {
    const raw = await this.client.eval(`
      local old = redis.call('GET', KEYS[1])
      if old and cjson.decode(old).score >= tonumber(ARGV[1]) then return old end
      redis.call('SET', KEYS[1], ARGV[2])
      return ARGV[2]
    `, { keys: [this.key(key)], arguments: [String(record.score), JSON.stringify(record)] });
    if (typeof raw !== 'string') throw new Error('Invalid Redis record response');
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('Invalid workspace record');
    return parsed;
  }
}
