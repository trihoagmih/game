import crypto from 'node:crypto';
import { createClient } from 'redis';

const RENEW = `if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('EXPIRE',KEYS[1],ARGV[2]) else return 0 end`;
const TRANSFER = `if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',86400); return 1 else return 0 end`;
const RELEASE = `if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end`;

// Static shard IDs have stable proxy routes. Exactly one process owns a shard.
// Redis contains directory/identity metadata; game mutations stay on the room's owner.
export class Cluster {
  constructor({ url, nodeId, nodes, namespace = 'game:v1', onLeaseLost = () => process.exit(1) }) {
    if (!/^[a-z0-9-]{1,24}$/.test(nodeId) || !nodes.includes(nodeId)
      || nodes.some((id) => !/^[a-z0-9-]{1,24}$/.test(id))) throw new Error('Invalid NODE_ID / CLUSTER_NODES');
    this.nodeId = nodeId;
    this.nodes = [...new Set(nodes)];
    this.prefix = namespace;
    this.owner = crypto.randomUUID();
    this.client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: false }, disableOfflineQueue: true });
    this.client.on('error', (error) => console.error('[redis]', error.message));
    this.onLeaseLost = onLeaseLost;
    this.directory = [];
    this.ready = false;
  }

  key(suffix) { return `${this.prefix}:${suffix}`; }
  routeKey(token) { return this.key(`route:${token}`); }

  async start(lobby) {
    this.lobby = lobby;
    await this.client.connect();
    const acquired = await this.client.set(this.key(`lease:${this.nodeId}`), this.owner, { NX: true, EX: 15 });
    if (!acquired) throw new Error(`Shard ${this.nodeId} already has an owner; wait for lease expiry`);
    this.ready = true;
    await this.tick();
    this.timer = setInterval(() => this.tick().catch((error) => this.fence(error)), 2000);
    this.timer.unref();
  }

  async tick() {
    if (this.ticking || !this.ready) return;
    this.ticking = true;
    try {
      const valid = await this.client.eval(RENEW, { keys: [this.key(`lease:${this.nodeId}`)], arguments: [this.owner, '15'] });
      if (!valid) throw new Error('Lost shard ownership');
      this.renewedAt = Date.now();
      if (!this.identitiesRenewedAt || Date.now() - this.identitiesRenewedAt > 60_000) {
        for (const user of this.lobby.users.values()) {
          if (user.transferred || (!user.sockets.size && !user.roomId)) continue;
          await this.saveIdentity(user);
          await this.client.eval(RENEW, { keys: [this.routeKey(user.token)], arguments: [this.nodeId, '86400'] });
        }
        this.identitiesRenewedAt = Date.now();
      }
      const rooms = [...this.lobby.rooms.values()].map((room) => ({ ...room.summary(), server: room.server, nodeId: this.nodeId }));
      const online = this.lobby.localOnlineList ? this.lobby.localOnlineList() : [];
      await this.client.set(this.key(`node:${this.nodeId}`), JSON.stringify({ id: this.nodeId, owner: this.owner, rooms, online, draining: !!this.lobby.draining }), { EX: 10 });
      const values = await this.client.mGet(this.nodes.map((id) => this.key(`node:${id}`)));
      const next = values.filter(Boolean).map((value) => JSON.parse(value));
      const changed = JSON.stringify(next) !== JSON.stringify(this.directory);
      this.directory = next;
      if (changed) for (const server of new Set([...this.lobby.users.values()].map((u) => u.server))) this.lobby.broadcast(server);
    } finally { this.ticking = false; }
  }

  fence(error) {
    if (!this.ready) return;
    this.ready = false;
    console.error('[cluster fenced]', error.message);
    this.onLeaseLost(error);
  }

  roomList(server) {
    const local = [...this.lobby.rooms.values()].map((room) => ({ ...room.summary(), server: room.server }));
    return [...this.directory.filter((node) => node.id !== this.nodeId).flatMap((node) => node.rooms), ...local].filter((room) => room.server === server)
      .map(({ server: _, nodeId, ...room }) => room).sort((a, b) => b.createdAt - a.createdAt);
  }

  onlineList(server) {
    const unique = new Map();
    for (const user of this.directory.flatMap((node) => node.online)) {
      if (user.server === server) { const { server: _, ...view } = user; unique.set(user.id, view); }
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  placement() {
    const nodes = this.directory.filter((node) => !node.draining).sort((a, b) => a.rooms.length - b.rooms.length || a.id.localeCompare(b.id));
    if (!nodes.length) throw new Error('Chưa có máy chủ sẵn sàng');
    return nodes[0].id;
  }

  ownerOfRoom(id, server) {
    return this.directory.flatMap((node) => node.rooms).find((room) => room.id === id && room.server === server)?.nodeId;
  }

  async identity(token, server) {
    if (typeof token !== 'string' || token.length > 128) return null;
    const value = await this.client.get(this.key(`identity:${token}`));
    if (!value) return null;
    const user = JSON.parse(value);
    return user.server === server ? user : null;
  }

  async saveIdentity(user) {
    await this.client.set(this.key(`identity:${user.token}`), JSON.stringify({ id: user.id, token: user.token, name: user.name, server: user.server }), { EX: 86400 });
  }

  async claimUser(user) {
    const key = this.routeKey(user.token);
    await this.client.set(key, this.nodeId, { NX: true, EX: 86400 });
    const owner = await this.client.get(key);
    if (!this.nodes.includes(owner)) throw new Error('Invalid identity route');
    if (owner === this.nodeId) await this.client.expire(key, 86400);
    return owner;
  }

  async transfer(user, nodeId) {
    if (!this.ready || !this.directory.some((node) => node.id === nodeId && !node.draining)) throw new Error('Máy chủ chưa sẵn sàng');
    if (user.sockets.size > 1) throw new Error('Hãy đóng các tab game khác trước khi chuyển phòng');
    if (user.roomId) this.lobby.leave(user);
    await this.saveIdentity(user);
    const ok = await this.client.eval(TRANSFER, { keys: [this.routeKey(user.token)], arguments: [this.nodeId, nodeId] });
    if (!ok) throw new Error('Danh tính đã chuyển sang máy chủ khác');
    user.transferred = true;
    return { redirect: { nodeId } };
  }

  async close() {
    clearInterval(this.timer);
    const wasReady = this.ready;
    this.ready = false;
    if (this.client.isOpen) {
      if (wasReady) {
        // Release the directory before the lease; another owner can then safely start.
        await this.client.del(this.key(`node:${this.nodeId}`));
        await this.client.eval(RELEASE, { keys: [this.key(`lease:${this.nodeId}`)], arguments: [this.owner] });
      }
      await this.client.quit();
    }
  }
}

export function clusterFromEnv() {
  if (!process.env.REDIS_URL) return null;
  return new Cluster({ url: process.env.REDIS_URL, nodeId: process.env.NODE_ID,
    nodes: (process.env.CLUSTER_NODES || '').split(',').map((s) => s.trim()).filter(Boolean),
    namespace: process.env.REDIS_NAMESPACE || 'game:v1' });
}
