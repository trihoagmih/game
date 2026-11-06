// Trạng thái trong bộ nhớ: người dùng, phòng, và các thao tác vào / ra / xóa phòng.
import crypto from 'node:crypto';
import { LIMITS } from './config.js';
import { GAMES } from './games/index.js';

export const newId = (n = 8) => crypto.randomBytes(n).toString('base64url').slice(0, n);
export const cleanName = (s, max = 24) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} token   bí mật để vào lại đúng danh tính
 * @property {string} name
 * @property {string} server  id server (sảnh) của danh tính
 * @property {Set<string>} sockets  các tab đang kết nối
 * @property {string|null} roomId
 * @property {any} graceTimer  hẹn giờ đưa ra khỏi phòng khi mất kết nối
 * @property {number} lastSeen
 */

export class Room {
  constructor(lobby, { name, game, owner, options }) {
    this.lobby = lobby;
    this.id = newId(6);
    this.server = owner.server; // phòng thuộc server của người tạo
    this.name = name;
    this.game = game;
    this.ownerId = owner.id;
    this.createdAt = Date.now();
    this.members = new Set();
    this.chat = [];
    this.voice = new Map(); // userId -> { muted, sid } — ai đang trong kênh thoại của phòng
    this.handler = new GAMES[game].Handler(this, options);
    this._pending = false;
    this._summaryKey = null;
    this._presenceKey = null;
  }

  isOnline(id) { return this.lobby.isOnline(id); }
  /** Tên người chơi; máy (bot) không phải người dùng nên hỏi bàn chơi. */
  nameOf(id) { return this.handler.botName?.(id) ?? this.lobby.nameOf(id); }
  hasOnlineMember() { return [...this.members].some((id) => this.lobby.isOnline(id)); }

  system(text) { this.addChat({ system: true, text }); }

  addChat(m) {
    this.chat.push({ ...m, ts: Date.now(), id: newId(6) });
    if (this.chat.length > LIMITS.chatHistory) this.chat.shift();
  }

  /** Gộp các thay đổi trong cùng tick rồi phát trạng thái cho mọi thành viên và sảnh. */
  changed() {
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => {
      this._pending = false;
      if (!this.lobby.rooms.has(this.id)) return;
      const common = this.commonView();
      for (const uid of this.members) this.lobby.toUser(uid).emit('room:state', this.viewFor(uid, common));
      const summaryKey = JSON.stringify(this.summary());
      const presenceKey = JSON.stringify([this.name, [...this.members], this.handler.playerIds()]);
      if (summaryKey !== this._summaryKey || presenceKey !== this._presenceKey) {
        this.lobby.broadcast(this.server, { rooms: summaryKey !== this._summaryKey, online: presenceKey !== this._presenceKey });
        this._summaryKey = summaryKey;
        this._presenceKey = presenceKey;
      }
    });
  }

  commonView() {
    const { lobby } = this;
    const players = new Set(this.handler.playerIds());
    return {
      id: this.id,
      name: this.name,
      game: this.game,
      ownerId: this.ownerId,
      members: [...this.members].map((id) => ({
        id,
        name: lobby.nameOf(id),
        role: players.has(id) ? 'player' : 'spectator',
        online: lobby.isOnline(id),
      })),
      chat: this.chat.slice(-60),
      voice: [...this.voice].map(([id, v]) => ({ id, muted: v.muted })),
      serverTime: Date.now(),
    };
  }

  viewFor(uid, common = this.commonView()) {
    return { ...common, state: this.handler.view(uid) };
  }

  summary() {
    const { lobby } = this;
    const players = this.handler.playerIds();
    return {
      id: this.id,
      name: this.name,
      game: this.game,
      gameName: GAMES[this.game].name,
      ownerId: this.ownerId,
      ownerName: lobby.nameOf(this.ownerId),
      players: players.length,
      playerNames: players.map((id) => this.nameOf(id)),
      maxPlayers: this.handler.maxPlayers,
      spectators: this.members.size - players.length,
      playing: this.handler.isPlaying(),
      options: this.handler.options,
      createdAt: this.createdAt,
    };
  }
}

export class Lobby {
  /** @param {import('socket.io').Server} io */
  constructor(io) {
    this.io = io;
    /** @type {Map<string, User>} */
    this.users = new Map();
    /** @type {Map<string, User>} */
    this.byToken = new Map();
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this._broadcastPending = new Map();
    // Dọn danh tính lâu không hoạt động để bộ nhớ không tăng mãi
    setInterval(() => this.sweepIdleUsers(), 10 * 60_000).unref();
  }

  // ---------- Người dùng ----------

  isOnline(id) { return (this.users.get(id)?.sockets.size || 0) > 0; }
  nameOf(id) { return this.users.get(id)?.name || '?'; }
  toUser(id) { return this.io.to('u:' + id); }

  /** Danh tính theo token, chỉ khi thuộc đúng server. */
  findUser(token, serverId) {
    const u = typeof token === 'string' && this.byToken.get(token);
    return u && u.server === serverId ? u : null;
  }

  createUser(name, serverId) {
    /** @type {User} */
    const u = {
      id: newId(10),
      token: crypto.randomBytes(18).toString('base64url'),
      name,
      server: serverId,
      sockets: new Set(),
      roomId: null,
      graceTimer: null,
      lastSeen: Date.now(),
    };
    this.users.set(u.id, u);
    this.byToken.set(u.token, u);
    return u;
  }

  sweepIdleUsers() {
    const cutoff = Date.now() - LIMITS.userIdleMs;
    for (const u of this.users.values()) {
      if (u.sockets.size || u.roomId || u.lastSeen > cutoff) continue;
      this.users.delete(u.id);
      this.byToken.delete(u.token);
    }
  }

  // ---------- Sảnh ----------

  /** Mỗi server có sảnh riêng: chỉ thấy phòng của server mình. */
  roomList(serverId) {
    if (this.cluster) return this.cluster.roomList(serverId);
    return [...this.rooms.values()]
      .filter((r) => r.server === serverId)
      .map((r) => r.summary())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Người đang kết nối trong server: đang ở sảnh hay ở phòng nào, chơi hay xem. */
  onlineList(serverId) {
    if (this.cluster) return this.cluster.onlineList(serverId);
    const list = [];
    for (const u of this.users.values()) {
      if (u.server !== serverId || !u.sockets.size) continue;
      const room = u.roomId && this.rooms.get(u.roomId);
      list.push({
        id: u.id,
        name: u.name,
        room: room ? { id: room.id, name: room.name, game: room.game, playing: room.handler.playerIds().includes(u.id) } : null,
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  localOnlineList() {
    const result = [];
    for (const u of this.users.values()) {
      if (!u.sockets.size || u.transferred) continue;
      const room = this.rooms.get(u.roomId);
      result.push({ id: u.id, name: u.name, server: u.server,
        room: room ? { id: room.id, name: room.name, game: room.game, playing: room.handler.playerIds().includes(u.id) } : null });
    }
    return result;
  }

  importUser(identity) {
    const existing = this.users.get(identity.id);
    if (existing) { existing.transferred = false; existing.name = identity.name; return existing; }
    const user = { ...identity, roomId: null, sockets: new Set(), graceTimer: null, lastSeen: Date.now() };
    this.users.set(user.id, user);
    this.byToken.set(user.token, user);
    return user;
  }

  /** Phát danh sách phòng và người online cho sảnh, gộp các thay đổi trong 100ms. */
  broadcast(serverId, { rooms = true, online = true } = {}) {
    const pending = this._broadcastPending.get(serverId);
    if (pending) {
      pending.rooms ||= rooms;
      pending.online ||= online;
      return;
    }
    const updates = { rooms, online };
    this._broadcastPending.set(serverId, updates);
    setTimeout(() => {
      this._broadcastPending.delete(serverId);
      if (updates.rooms) this.io.to('lobby:' + serverId).emit('lobby:rooms', this.roomList(serverId));
      if (updates.online) this.io.to('lobby:' + serverId).emit('lobby:online', this.onlineList(serverId));
    }, 100);
  }

  // ---------- Phòng ----------

  /** Phòng theo id, chỉ khi cùng server với người dùng. */
  roomFor(user, id) {
    const r = id && this.rooms.get(id);
    return r && r.server === user.server ? r : null;
  }

  /** Phòng người dùng đang ở, báo lỗi nếu chưa vào phòng nào. */
  currentRoom(user) {
    const room = user.roomId && this.rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    return room;
  }

  createRoom(owner, { name, game, options }) {
    const mine = [...this.rooms.values()].filter((r) => r.server === owner.server);
    if (mine.filter((r) => r.ownerId === owner.id).length >= LIMITS.roomsPerUser) throw new Error(`Bạn chỉ được tạo tối đa ${LIMITS.roomsPerUser} phòng`);
    if (mine.length >= LIMITS.roomsPerServer) throw new Error('Sảnh đã đủ phòng, hãy vào một phòng có sẵn');
    const room = new Room(this, { name, game, owner, options });
    this.rooms.set(room.id, room);
    room.system(`${owner.name} tạo phòng "${name}"`);
    return room;
  }

  /** Vào phòng để chơi ('play') hoặc xem ('watch'). Trả về cảnh báo nếu không ngồi được. */
  join(user, room, mode) {
    // Check before leaving the current room; rejoining an existing seat is always allowed.
    if (!room.members.has(user.id) && room.members.size >= room.handler.maxPlayers + LIMITS.spectatorsPerRoom) {
      throw new Error('Phòng đã đủ người xem');
    }
    if (user.roomId && user.roomId !== room.id) this.leave(user);
    const isNew = !room.members.has(user.id);
    room.members.add(user.id);
    user.roomId = room.id;
    if (isNew) room.system(`${user.name} vào phòng${mode === 'watch' ? ' (xem)' : ''}`);
    let warning = null;
    if (mode === 'play' && !room.handler.playerIds().includes(user.id)) {
      try {
        room.handler.sit(user);
      } catch (e) {
        warning = e.message + ' — bạn đang ở chế độ xem';
      }
    }
    room.changed();
    return warning;
  }

  /**
   * Ra khỏi phòng. Không còn ai đang kết nối trong phòng thì xóa luôn phòng
   * (những người đang mất kết nối chờ vào lại cũng bị đưa ra) để không giữ lại tài nguyên vô ích.
   */
  leave(user) {
    const room = user.roomId && this.rooms.get(user.roomId);
    user.roomId = null;
    if (!room) return;
    room.handler.onLeave(user.id);
    room.members.delete(user.id);
    room.voice.delete(user.id);
    this.toUser(user.id).emit('room:left', { roomId: room.id });
    if (!room.hasOnlineMember()) return this.close(room, 'Phòng trống');
    room.system(`${user.name} đã rời phòng`);
    if (room.ownerId === user.id) {
      const next = room.handler.playerIds().find((id) => room.members.has(id) && this.isOnline(id))
        || [...room.members].find((id) => this.isOnline(id));
      room.ownerId = next;
      room.system(`${this.nameOf(next)} trở thành chủ phòng`);
    }
    room.changed();
  }

  /** Xóa phòng, báo cho mọi thành viên còn lại. */
  close(room, reason) {
    room.handler.dispose();
    this.rooms.delete(room.id);
    for (const uid of room.members) {
      const u = this.users.get(uid);
      if (u && u.roomId === room.id) u.roomId = null;
      this.toUser(uid).emit('room:closed', { roomId: room.id, reason });
    }
    room.members.clear();
    room.voice.clear();
    this.broadcast(room.server);
  }

  /** Đưa mọi người ra khỏi kênh thoại (vd. voice chat vừa bị tắt). */
  clearVoice(message) {
    for (const room of this.rooms.values()) {
      if (!room.voice.size) continue;
      room.voice.clear();
      room.system(message);
      room.changed();
    }
  }
}
