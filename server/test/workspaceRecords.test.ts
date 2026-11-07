import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from 'redis';
import { FileRecordBackend, RedisRecordBackend, WorkspaceRecords } from '../src/workspaceRecords.js';
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
  first.handler.action(owner.id, { type: 'giveup' });
  await Promise.resolve();
  assert.equal(second.workspaceRecord()?.score, 650);
  assert.ok(second.handler instanceof GoldmineHandler);
  assert.equal(second.handler.view(secondOwner.id).workspaceRecord?.score, 650);
  assert.equal(other.workspaceRecord(), null);
  lobby.rooms.delete(first.id);
  assert.equal(second.workspaceRecord()?.name, 'An');
});

test('Redis records use atomic max across shards and never expire', { skip: !process.env.TEST_REDIS_URL }, async (t) => {
  const client = createClient({ url: process.env.TEST_REDIS_URL });
  await client.connect();
  const prefix = 'test:workspace-records:' + crypto.randomUUID();
  t.after(async () => {
    const keys = await client.keys(prefix + '*');
    if (keys.length) await client.del(keys);
    await client.quit();
  });
  const a = new WorkspaceRecords(new RedisRecordBackend(client, prefix));
  const b = new WorkspaceRecords(new RedisRecordBackend(client, prefix));
  await Promise.all([a.submit('b4', 'skyhop', record(20)), b.submit('b4', 'skyhop', record(50)), a.submit('b4', 'skyhop', record(30))]);
  const stored = new RedisRecordBackend(client, prefix);
  assert.equal((await stored.read(a.key('b4', 'skyhop')))?.score, 50);
  assert.equal(await stored.read(a.key('other', 'skyhop')), null);
  assert.equal(await client.ttl(prefix + ':workspace-record:' + a.key('b4', 'skyhop')), -1);
});
