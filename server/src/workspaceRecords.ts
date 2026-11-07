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

/** PostgreSQL là nguồn kỷ lục chính; UPSERT giữ max dưới cập nhật đồng thời. */
export class PostgresRecordBackend implements RecordBackend {
  constructor(private pool: import('pg').Pool, private namespace = 'game:v1') {}

  async init() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Hai shard có thể khởi động đồng thời trên database mới.
      await client.query('SELECT pg_advisory_xact_lock(61023511)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS workspace_game_records (
          namespace text NOT NULL,
          record_key text NOT NULL,
          score bigint NOT NULL CHECK (score > 0),
          record jsonb NOT NULL,
          PRIMARY KEY (namespace, record_key)
        )
      `);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async read(key: string) {
    const result = await this.pool.query<{ record: unknown }>(
      'SELECT record FROM workspace_game_records WHERE namespace = $1 AND record_key = $2',
      [this.namespace, key],
    );
    const record = result.rows[0]?.record;
    if (record === undefined) return null;
    if (!isRecord(record)) throw new Error('Invalid workspace record');
    return record;
  }

  async update(key: string, record: WorkspaceRecord) {
    const result = await this.pool.query<{ record: unknown }>(`
      INSERT INTO workspace_game_records (namespace, record_key, score, record)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (namespace, record_key) DO UPDATE SET
        record = CASE WHEN EXCLUDED.score > workspace_game_records.score
          THEN EXCLUDED.record ELSE workspace_game_records.record END,
        score = GREATEST(workspace_game_records.score, EXCLUDED.score)
      RETURNING record
    `, [this.namespace, key, record.score, JSON.stringify(record)]);
    const saved = result.rows[0]?.record;
    if (!isRecord(saved)) throw new Error('Invalid workspace record');
    return saved;
  }
}
