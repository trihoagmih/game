import { encrypt, decrypt, pack, unpack, encryptionKey } from './snapshot.js';
import { resumeRoom } from './resumeRoom.js';
import { RECONNECT_GRACE_MS } from './config.js';

const SAVE = `if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[2],ARGV[2]); return 1 else return 0 end`;

export class Recovery {
  constructor(cluster, lobby, secret) {
    this.cluster = cluster;
    this.lobby = lobby;
    this.key = encryptionKey(secret);
    this.saving = null;
  }

  async restore() {
    const value = await this.cluster.client.get(this.cluster.key(`snapshot:${this.cluster.nodeId}`));
    if (!value) return;
    const state = unpack(decrypt(value, this.key));
    if (state.nodeId !== this.cluster.nodeId) throw new Error('Snapshot shard mismatch');
    for (const user of state.users) {
      user.sockets = new Set();
      user.graceTimer = null;
      this.lobby.users.set(user.id, user);
      this.lobby.byToken.set(user.token, user);
    }
    for (const room of state.rooms) {
      room.lobby = this.lobby;
      room.voice = new Map();
      room._pending = false;
      room.handler.room = room;
      if (room.handler.ready?.room === undefined && room.handler.ready?.ids instanceof Set) room.handler.ready.room = room;
      this.lobby.rooms.set(room.id, room);
    }
    for (const user of this.lobby.users.values()) {
      user.graceTimer = setTimeout(() => { if (!user.sockets.size) this.lobby.leave(user); }, RECONNECT_GRACE_MS);
      user.graceTimer.unref();
    }
    for (const room of this.lobby.rooms.values()) resumeRoom(room);
    console.log(JSON.stringify({ event: 'snapshot.restored', rooms: state.rooms.length, savedAt: state.savedAt }));
  }

  start() {
    this.timer = setInterval(() => {
      Promise.resolve().then(() => this.save()).catch((error) => this.cluster.fence(error));
    }, 2000);
    this.timer.unref();
  }

  save() {
    if (this.saving) return this.saving;
    const state = { nodeId: this.cluster.nodeId, savedAt: Date.now(),
      users: [...this.lobby.users.values()].filter((user) => !user.transferred), rooms: [...this.lobby.rooms.values()] };
    const buffer = pack(state);
    if (buffer.length > 32 * 1024 * 1024) throw new Error('Snapshot exceeds 32 MB; add shards or lower room limits');
    const value = encrypt(buffer, this.key);
    this.saving = this.cluster.client.eval(SAVE, {
      keys: [this.cluster.key(`lease:${this.cluster.nodeId}`), this.cluster.key(`snapshot:${this.cluster.nodeId}`)],
      arguments: [this.cluster.owner, value],
    }).then((ok) => { if (!ok) throw new Error('Snapshot rejected: lost ownership'); })
      .finally(() => { this.saving = null; });
    return this.saving;
  }

  async close() { clearInterval(this.timer); await this.saving; await this.save(); }
}
