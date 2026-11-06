import test from 'node:test';
import assert from 'node:assert/strict';
import { Cluster } from '../src/cluster.js';

test('directory filters logical servers and places new rooms only on available shards', () => {
  const cluster = new Cluster({ url: 'redis://localhost', nodeId: 'a', nodes: ['a', 'b'] });
  cluster.lobby = { rooms: new Map() };
  cluster.directory = [
    { id: 'a', rooms: [{ id: 'r1', server: 'private', nodeId: 'a' }], online: [], draining: true },
    { id: 'b', rooms: [{ id: 'r2', server: 'public', nodeId: 'b' }], online: [{ id: 'u', server: 'private', name: 'Private' }] },
  ];
  assert.equal(cluster.placement(), 'b');
  assert.deepEqual(cluster.roomList('public'), [{ id: 'r2' }]);
  assert.equal(cluster.ownerOfRoom('r1', 'public'), undefined);
  assert.equal(cluster.ownerOfRoom('r1', 'private'), 'a');
  assert.deepEqual(cluster.onlineList('public'), []);
});

test('duplicate shard owners are rejected by Redis; identities and transfer use compare-and-set', { skip: !process.env.TEST_REDIS_URL }, async (t) => {
  const namespace = `test:${Date.now()}:${process.pid}`;
  const make = (id) => new Cluster({ url: process.env.TEST_REDIS_URL, nodeId: id, nodes: ['a', 'b'], namespace });
  const lobby = () => ({ rooms: new Map(), users: new Map(), localOnlineList: () => [], broadcast() {}, leave(user) { user.roomId = null; } });
  const a = make('a'), b = make('b'), duplicate = make('a');
  t.after(async () => { for (const node of [duplicate, b, a]) await node.close(); });
  await a.start(lobby());
  await b.start(lobby());
  await a.tick();
  await assert.rejects(duplicate.start(lobby()), /already has an owner/);
  const user = { id: 'u', token: 'secret', name: 'User', server: 's1', sockets: new Set(['socket']), roomId: null };
  await a.saveIdentity(user);
  assert.equal((await b.identity('secret', 's1')).id, 'u');
  assert.equal(await b.identity('secret', 's2'), null);
  assert.equal(await a.claimUser(user), 'a');
  assert.deepEqual(await a.transfer(user, 'b'), { redirect: { nodeId: 'b' } });
  assert.equal(await b.claimUser(user), 'b');
  await assert.rejects(a.transfer(user, 'b'), /đã chuyển/);
  await a.client.del(a.routeKey(user.token), a.key(`identity:${user.token}`));
});
