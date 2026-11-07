import test from 'node:test';
import assert from 'node:assert/strict';
import { Cluster } from '../src/cluster.js';
import { LIMITS } from '../src/config.js';
import { Lobby } from '../src/lobby.js';
import { keyedTokenBucket } from '../src/rateLimit.js';

test('failed transfer preserves existing membership; successful transfer leaves only after CAS', async () => {
  for (const failure of ['identity', 'cas-error', 'cas-rejected', null]) {
    const cluster = new Cluster({ url: 'redis://localhost', nodeId: 'a', nodes: ['a', 'b'] });
    cluster.ready = true;
    cluster.directory = [{ id: 'b' }] as typeof cluster.directory;
    let committed = false;
    cluster.saveIdentity = async () => { if (failure === 'identity') throw new Error('identity failure'); };
    cluster.client = { eval: async () => {
      if (failure === 'cas-error') throw new Error('network failure');
      if (failure === 'cas-rejected') return 0;
      committed = true;
      return 1;
    } } as unknown as typeof cluster.client;
    cluster.lobby = { leave(user: import('../src/lobby.js').User) { assert.ok(committed); user.roomId = null; } } as unknown as typeof cluster.lobby;
    const user = { token: 'secret', sockets: new Set(['s']), roomId: 'old-room' } as unknown as import('../src/lobby.js').User;
    if (failure) {
      await assert.rejects(cluster.transfer(user as unknown as Parameters<typeof cluster.transfer>[0], 'b'));
      assert.equal(user.roomId, 'old-room');
    } else {
      await cluster.transfer(user as unknown as Parameters<typeof cluster.transfer>[0], 'b');
      assert.equal(user.roomId, null);
      assert.equal(user.transferred, true);
    }
  }
});

test('directory filters logical servers and places new rooms only on available shards', () => {
  const cluster = new Cluster({ url: 'redis://localhost', nodeId: 'a', nodes: ['a', 'b'] });
  cluster.lobby = { rooms: new Map() } as unknown as typeof cluster.lobby;
  cluster.directory = [
    { id: 'a', rooms: [{ id: 'r1', server: 'private', nodeId: 'a' }], online: [], draining: true },
    { id: 'b', rooms: [{ id: 'r2', server: 'public', nodeId: 'b' }], online: [{ id: 'u', server: 'private', name: 'Private' }] },
  ] as unknown as typeof cluster.directory;
  assert.equal(cluster.placement('public'), 'b');
  assert.deepEqual(cluster.roomList('public'), [{ id: 'r2' }]);
  assert.equal(cluster.ownerOfRoom('r1', 'public'), undefined);
  assert.equal(cluster.ownerOfRoom('r1', 'private'), 'a');
  assert.deepEqual(cluster.onlineList('public'), []);
});

/** Directory giả: mỗi shard có số phòng theo từng sảnh. */
function directoryOf(nodes: { id: string; rooms: Record<string, number>; draining?: boolean }[]) {
  return nodes.map(({ id, rooms, draining = false }) => ({
    id, owner: id, online: [], draining,
    rooms: Object.entries(rooms).flatMap(([server, count]) =>
      Array.from({ length: count }, (_, i) => ({ id: `${id}-${server}-${i}`, server, nodeId: id }))),
  })) as unknown as Cluster['directory'];
}

test('placement keeps a logical server on its home shard until the load gap reaches the slack', () => {
  const cluster = new Cluster({ url: 'redis://localhost', nodeId: 'a', nodes: ['a', 'b', 'c'] });
  const gap = LIMITS.affinitySlack;
  cluster.directory = directoryOf([{ id: 'a', rooms: { team: 3, other: gap - 4 } }, { id: 'b', rooms: {} }, { id: 'c', rooms: { team: 1 } }]);
  assert.equal(cluster.placement('team'), 'a', 'most rooms of the server win while within slack');
  assert.equal(cluster.placement('new'), 'b', 'a server without rooms goes to the least-loaded shard');
  cluster.directory = directoryOf([{ id: 'a', rooms: { team: 3, other: gap - 3 } }, { id: 'b', rooms: {} }, { id: 'c', rooms: { team: 1 } }]);
  assert.equal(cluster.placement('team'), 'c', 'spill to the next shard that already hosts the server');
  cluster.directory = directoryOf([{ id: 'a', rooms: { team: gap } }, { id: 'b', rooms: {} }]);
  assert.equal(cluster.placement('team'), 'b', 'spill to the least-loaded shard when no home is within slack');
  cluster.directory = directoryOf([{ id: 'a', rooms: { team: 5 }, draining: true }, { id: 'b', rooms: { other: 9 } }]);
  assert.equal(cluster.placement('team'), 'b', 'a draining home shard is never chosen');
});

test('room quota of a logical server counts rooms on every shard', () => {
  const io = { to: () => ({ emit() {} }) };
  const lobby = new Lobby(io as unknown as ConstructorParameters<typeof Lobby>[0]);
  const cluster = new Cluster({ url: 'redis://localhost', nodeId: 'a', nodes: ['a', 'b'] });
  cluster.lobby = lobby;
  lobby.cluster = cluster;
  const owner = lobby.createUser('Owner', 'team');
  cluster.directory = directoryOf([{ id: 'a', rooms: {} }, { id: 'b', rooms: { team: LIMITS.roomsPerServer - 1, other: 5 } }]);
  const room = lobby.createRoom(owner, { name: 'Last', game: 'caro', options: {} });
  assert.throws(() => lobby.assertCanCreateRoom(owner), /Sảnh đã đủ phòng/);
  assert.doesNotThrow(() => lobby.assertCanCreateRoom(lobby.createUser('Other', 'other')), 'other servers keep their own quota');
  room.handler.dispose();
});

test('keyed token buckets limit each key independently', () => {
  const take = keyedTokenBucket([2, 0]);
  assert.deepEqual([take('team'), take('team'), take('team'), take('other')], [true, true, false, true]);
});

test('lease renewal proceeds while a metadata tick is blocked on identity storage', async () => {
  const cluster = new Cluster({ url: 'redis://localhost', nodeId: 'a', nodes: ['a'] });
  cluster.ready = true;
  cluster.lobby = { users: new Map([['u', { token: 't', sockets: new Set(['s']) }]]), rooms: new Map(), broadcast() {} } as unknown as typeof cluster.lobby;
  let release!: () => void;
  cluster.saveIdentity = () => new Promise<void>((resolve) => { release = resolve; });
  cluster.client = { eval: async () => 1, set: async () => {}, mGet: async () => [] } as unknown as typeof cluster.client;
  let renewals = 0;
  cluster.leaseClient = { eval: async () => { renewals++; return 1; } } as unknown as typeof cluster.leaseClient;
  const tick = cluster.tick();
  assert.equal(cluster.ticking, true);
  await cluster.renewLease();
  await cluster.renewLease();
  assert.equal(renewals, 2);
  assert.ok(cluster.renewedAt > 0);
  release();
  await tick;
});

test('duplicate shard owners are rejected by Redis; identities and transfer use compare-and-set', { skip: !process.env.TEST_REDIS_URL }, async (t) => {
  const namespace = `test:${Date.now()}:${process.pid}`;
  const make = (id: string) => new Cluster({ url: process.env.TEST_REDIS_URL!, nodeId: id, nodes: ['a', 'b'], namespace });
  const lobby = () => ({ rooms: new Map(), users: new Map(), localOnlineList: () => [], broadcast() {}, leave(user: { roomId: string | null }) { user.roomId = null; } });
  const a = make('a'), b = make('b'), duplicate = make('a');
  t.after(async () => { for (const node of [duplicate, b, a]) await node.close(); });
  await a.start(lobby() as unknown as import('../src/lobby.js').Lobby);
  await b.start(lobby() as unknown as import('../src/lobby.js').Lobby);
  await a.tick();
  await assert.rejects(duplicate.start(lobby() as unknown as import('../src/lobby.js').Lobby), /already has an owner/);
  const user = { id: 'u', token: 'secret', name: 'User', server: 's1', sockets: new Set(['socket']), roomId: null };
  await a.saveIdentity(user);
  assert.equal((await b.identity('secret', 's1'))!.id, 'u');
  assert.equal(await b.identity('secret', 's2'), null);
  assert.equal(await a.claimUser(user as unknown as Parameters<typeof a.claimUser>[0]), 'a');
  assert.deepEqual(await a.transfer(user as unknown as Parameters<typeof a.transfer>[0], 'b'), { redirect: { nodeId: 'b' } });
  assert.equal(await b.claimUser(user as unknown as Parameters<typeof b.claimUser>[0]), 'b');
  await assert.rejects(a.transfer(user as unknown as Parameters<typeof a.transfer>[0], 'b'), /đã chuyển/);
  await a.client.del([a.routeKey(user.token), a.key(`identity:${user.token}`)]);
});
