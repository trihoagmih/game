import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { createClient } from 'redis';

test('two real nodes route rooms and recover a committed move after owner crash', { skip: !process.env.TEST_REDIS_URL, timeout: 60_000 }, async (t) => {
  const namespace = `integration:${process.pid}:${Date.now()}`;
  const ports = { a: 18371, b: 18372 };
  const children = [], sockets = [];
  const redis = createClient({ url: process.env.TEST_REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: false } });
  redis.on('error', () => {});
  await redis.connect();
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    const running = children.filter((child) => child.exitCode === null && child.signalCode === null);
    const exits = running.map((child) => once(child, 'exit'));
    for (const child of running) child.kill();
    await Promise.all(exits);
    const keys = [];
    for await (const batch of redis.scanIterator({ MATCH: `${namespace}:*`, COUNT: 100 })) keys.push(...batch);
    if (keys.length) await redis.del(keys);
    await redis.quit();
  });
  async function start(id) {
    const child = spawn(process.execPath, ['server/src/index.js'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, REDIS_URL: process.env.TEST_REDIS_URL, REDIS_NAMESPACE: namespace, NODE_ID: id,
        CLUSTER_NODES: 'a,b', PORT: String(ports[id]), APP_PASSWORD: 'integration-only', APP_SERVERS: '', SNAPSHOT_KEY: 'ab'.repeat(32) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(output);
      try { if ((await fetch(`http://localhost:${ports[id]}/ready`)).ok) return child; } catch {}
      await wait(100);
    }
    throw new Error(`Node ${id} did not become ready: ${output}`);
  }
  async function connect(id) {
    const socket = io(`http://localhost:${ports[id]}`, { transports: ['websocket'], reconnection: false, auth: { password: 'integration-only' } });
    sockets.push(socket);
    socket.on('room:state', (state) => { socket.latest = state; });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const request = (socket, event, payload = {}) => new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (error, result) => error || !result?.ok ? reject(error || new Error(result?.error)) : resolve(result));
  });
  let a = await start('a');
  await start('b');
  await wait(2200);
  const owner = await connect('a');
  const identity = await request(owner, 'hello', { name: 'Owner' });
  const { roomId } = await request(owner, 'room:create', { game: 'caro' });
  const guest = await connect('b');
  const guestIdentity = await request(guest, 'hello', { name: 'Guest' });
  await wait(2200);
  const redirect = await request(guest, 'room:join', { roomId, mode: 'play' });
  assert.equal(redirect.redirect.nodeId, 'a');
  guest.disconnect();
  const player = await connect('a');
  await request(player, 'hello', { token: guestIdentity.token });
  await request(player, 'room:join', { roomId, mode: 'play' });
  await request(player, 'game:action', { type: 'ready' });
  await request(owner, 'game:action', { type: 'start' });
  await request(owner, 'game:action', { type: 'move', cell: 112 });
  await wait(2300);
  assert.ok(await redis.exists(`${namespace}:snapshot:a`));
  owner.disconnect();
  player.disconnect();
  const exited = once(a, 'exit');
  a.kill('SIGKILL');
  await exited;
  await wait(15_500);
  a = await start('a');
  const restored = await connect('a');
  const hello = await request(restored, 'hello', { token: identity.token });
  assert.equal(hello.user.id, identity.user.id);
  assert.equal(hello.roomId, roomId);
  for (let n = 0; n < 20 && !restored.latest; n++) await wait(50);
  assert.equal(restored.latest.state.board[112], 'x');
  assert.equal(restored.latest.state.myColor, 'x');
});
