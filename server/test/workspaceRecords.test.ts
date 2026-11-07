import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { FileRecordBackend, PostgresRecordBackend, WorkspaceRecords } from '../src/workspaceRecords.js';
import { Lobby } from '../src/lobby.js';
import { GoldmineHandler } from '../src/games/goldmine.js';

const record = (score: number, name = 'An') => ({ id: name, name, score, at: 1000 });

test('workspace record survives rooms, isolates workspace/game, and reloads after restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'game-records-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'records.json');
  const backend = new FileRecordBackend(path);
  await backend.load();
  const records = new WorkspaceRecords(backend);
  await Promise.all([
    records.submit('b4', 'goldmine', record(500)),
    records.submit('b4', 'goldmine', record(900, 'Bình')),
    records.submit('b4', 'goldmine', record(600)),
    records.submit('b4', 'skyhop', record(12)),
    records.submit('other', 'goldmine', record(10000)),
  ]);
  assert.equal(records.get('b4', 'goldmine')?.score, 900);
  assert.equal(records.get('b4', 'goldmine')?.name, 'Bình');
  assert.equal(records.get('b4', 'skyhop')?.score, 12);
  const restarted = new FileRecordBackend(path);
  await restarted.load();
  assert.equal((await restarted.read(records.key('b4', 'goldmine')))?.score, 900);
});

test('server-verified score is visible in another room in the same workspace only', async (t) => {
  const io = { to: () => ({ emit() {} }) };
  const lobby = new Lobby(io as unknown as ConstructorParameters<typeof Lobby>[0]);
  const owner = lobby.createUser('An', 'b4');
  const first = lobby.createRoom(owner, { name: 'one', game: 'goldmine', options: {} });
  const secondOwner = lobby.createUser('Bình', 'b4');
  const second = lobby.createRoom(secondOwner, { name: 'two', game: 'goldmine', options: {} });
  const otherOwner = lobby.createUser('Other', 'other');
  const other = lobby.createRoom(otherOwner, { name: 'three', game: 'goldmine', options: {} });
  t.after(() => { for (const room of lobby.rooms.values()) room.handler.dispose(); });
  assert.ok(first.handler instanceof GoldmineHandler);
  first.handler.sit(owner);
  first.handler.action(owner.id, { type: 'start' });
  first.handler.players[0].game.money = 650;
  first.handler.players[0].game.peakMoney = 900;
  first.handler.players[0].game.level = 3;
  first.handler.action(owner.id, { type: 'giveup' });
  await Promise.resolve();
  assert.equal(second.workspaceRecord()?.score, 900);
  assert.ok(second.handler instanceof GoldmineHandler);
  assert.equal(second.handler.view(secondOwner.id).workspaceRecord?.score, 900);
  assert.equal(second.workspaceRecord('level')?.score, 3);
  assert.equal(other.workspaceRecord(), null);
  lobby.rooms.delete(first.id);
  assert.equal(second.workspaceRecord()?.name, 'An');
});

test('PostgreSQL keeps atomic max across nodes, restarts and isolated metrics', { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const namespace = 'test-' + crypto.randomUUID();
  t.after(async () => {
    await pool.query('DELETE FROM workspace_game_records WHERE namespace = $1', [namespace]);
    await pool.end();
  });
  const backend = new PostgresRecordBackend(pool, namespace);
  await Promise.all([backend.init(), new PostgresRecordBackend(pool, namespace).init()]);
  const a = new WorkspaceRecords(backend);
  const b = new WorkspaceRecords(new PostgresRecordBackend(pool, namespace));
  await Promise.all([a.submit('b4', 'skyhop', record(20)), b.submit('b4', 'skyhop', record(50)), a.submit('b4', 'skyhop', record(30))]);
  const restarted = new PostgresRecordBackend(pool, namespace);
  assert.equal((await restarted.read(a.key('b4', 'skyhop')))?.score, 50);
  await b.submit('b4', 'skyhop', record(50, 'Tie'));
  assert.equal((await restarted.read(a.key('b4', 'skyhop')))?.name, 'An');
  await a.submit('b4', 'goldmine', record(900));
  await b.submit('b4', 'goldmine:level', record(5));
  assert.equal((await restarted.read(a.key('b4', 'goldmine')))?.score, 900);
  assert.equal((await restarted.read(a.key('b4', 'goldmine:level')))?.score, 5);
  assert.equal(await restarted.read(a.key('other', 'skyhop')), null);
  assert.equal(await new PostgresRecordBackend(pool, namespace + '-other').read(a.key('b4', 'skyhop')), null);
});
