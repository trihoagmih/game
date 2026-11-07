// Trạng thái trong bộ nhớ: người dùng, phòng, và các thao tác vào / ra / xóa phòng.
import crypto from 'node:crypto';
import { WorkspaceRecords } from './workspaceRecords.js';
import type { WorkspaceRecord } from '@game/shared/race';
import { LIMITS } from './config.js';
import { GAMES, type GameId } from './games/index.js';
import type { GameServer } from './socketTypes.js';
import type { GameHandler } from './games/types.js';
import type { RoomState, RoomSummary, OnlineUser } from '@game/shared/contracts';
import type { Cluster, StoredIdentity } from './cluster.js';
import { GoldmineHandler } from './games/goldmine.js';
import { SkyhopHandler } from './games/skyhop.js';
import type { GoldmineView } from '@game/shared/goldmine';
import type { SkyhopView } from '@game/shared/skyhop';

export interface User {
  id: string; token: string; name: string; server: string; sockets: Set<string>;
  roomId: string | null; graceTimer: ReturnType<typeof setTimeout> | null; lastSeen: number;
  transferred?: boolean;
}
type RoomOptions = { name: string; game: GameId; owner: User; options: Record<string, unknown> };
type ChatEntry = RoomState['chat'][number];


export const newId = (n = 8) => crypto.randomBytes(n).toString('base64url').slice(0, n);
// eslint-disable-next-line no-control-regex -- Intentionally strip ASCII control characters from untrusted names.
export const cleanName = (s: unknown, max = 24) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);



export class Room {
  declare lobby: Lobby;
  declare id: string;
  declare server: string;
  declare name: string;
  declare game: GameId;
  declare ownerId: string;
  declare createdAt: number;
  declare members: Set<string>;
  declare chat: ChatEntry[];
  declare voice: Map<string, {muted: boolean; sid: string}>;
  declare handler: GameHandler;
  declare _pending: boolean;
  declare _summaryKey: string | null;
  declare _presenceKey: string | null;

  constructor(lobby: Lobby, { name, game, owner, options }: RoomOptions) {
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

  workspaceRecord(metric: 'score' | 'level' = 'score') {
    return this.lobby.records.get(this.server, metric === 'level' ? this.game + ':level' : this.game);
  }

  recordScore(record: WorkspaceRecord, metric: 'score' | 'level' = 'score') {
    if (this.lobby.frozen || this.lobby.draining) return;
    void this.lobby.records.submit(this.server, metric === 'level' ? this.game + ':level' : this.game, record)
      .catch(() => console.error('[workspace-records] save failed'));
  }

  isOnline(id: string) { return this.lobby.isOnline(id); }
  /** Tên người chơi; máy (bot) không phải người dùng nên hỏi bàn chơi. */
  nameOf(id: string) { return this.handler.botName?.(id) ?? this.lobby.nameOf(id); }
  hasOnlineMember() { return [...this.members].some((id) => this.lobby.isOnline(id)); }

  system(text: string) { this.addChat({ system: true, text }); }

  addChat(m: Omit<ChatEntry, 'id' | 'ts'>) {
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
      const race = this.handler instanceof GoldmineHandler || this.handler instanceof SkyhopHandler ? this.handler.view('') : undefined;
      for (const uid of this.members) this.lobby.toUser(uid).emit('room:state', this.viewFor(uid, common, race));
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

  viewFor(uid: string, common = this.commonView(), race?: GoldmineView | SkyhopView): RoomState {
    // Each Handler is created from GAMES[this.game] and declares the matching view type,
    // so the game id and its view stay correlated even though TypeScript cannot follow that here.
    const state = race ? { ...race, myId: race.seats.some((seat) => seat.id === uid) ? uid : null } : this.handler.view(uid);
    return { ...common, state } as RoomState;
  }

  summary(): RoomSummary {
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
      playerNames: players.map((id: string) => this.nameOf(id)),
      maxPlayers: this.handler.maxPlayers,
      spectators: this.members.size - players.length,
      playing: this.handler.isPlaying(),
      options: { ...this.handler.options },
      createdAt: this.createdAt,
    };
  }
}

export class Lobby {
  records = new WorkspaceRecords();
  declare io: GameServer;
  declare users: Map<string, User>;
  declare byToken: Map<string, User>;
  declare rooms: Map<string, Room>;
  declare _broadcastPending: Map<string, {rooms: boolean; online: boolean}>;
  declare cluster: Cluster | undefined;
  declare draining: boolean | undefined;
  declare frozen: boolean | undefined;

  /** @param {import('socket.io').Server} io */
  constructor(io: GameServer) {
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

  isOnline(id: string) { return (this.users.get(id)?.sockets.size || 0) > 0; }
  nameOf(id: string) { return this.users.get(id)?.name || '?'; }
  toUser(id: string): ReturnType<GameServer['to']> { return this.io.to('u:' + id); }

  /** Danh tính theo token, chỉ khi thuộc đúng server. */
  findUser(token: unknown, serverId: string) {
    const u = typeof token === 'string' && this.byToken.get(token);
    return u && u.server === serverId ? u : null;
  }

  createUser(name: string, serverId: string) {
    /** @type {User} */
    const u: User = {
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
  roomList(serverId: string): RoomSummary[] {
    if (this.cluster) return this.cluster.roomList(serverId);
    return [...this.rooms.values()]
      .filter((r) => r.server === serverId)
      .map((r) => r.summary())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Người đang kết nối trong server: đang ở sảnh hay ở phòng nào, chơi hay xem. */
  onlineList(serverId: string): OnlineUser[] {
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
      const room = u.roomId ? this.rooms.get(u.roomId) : undefined;
      result.push({ id: u.id, name: u.name, server: u.server,
        room: room ? { id: room.id, name: room.name, game: room.game, playing: room.handler.playerIds().includes(u.id) } : null });
    }
    return result;
  }

  importUser(identity: StoredIdentity): User {
    const existing = this.users.get(identity.id);
    if (existing) { existing.name = identity.name; return existing; }
    const user: User = { ...identity, roomId: null, sockets: new Set(), graceTimer: null, lastSeen: Date.now() };
    this.users.set(user.id, user);
    this.byToken.set(user.token, user);
    return user;
  }

  /** Phát danh sách phòng và người online cho sảnh, gộp các thay đổi trong 100ms. */
  broadcast(serverId: string, { rooms = true, online = true } = {}) {
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
  roomFor(user: User, id: string | null | undefined) {
    const r = id && this.rooms.get(id);
    return r && r.server === user.server ? r : null;
  }

  /** Phòng người dùng đang ở, báo lỗi nếu chưa vào phòng nào. */
  currentRoom(user: User) {
    const room = user.roomId && this.rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    return room;
  }

  /**
   * Hạn mức tạo phòng. Số phòng của sảnh tính trên toàn cluster theo directory (cập nhật mỗi tick),
   * nên hai shard tạo phòng cùng lúc có thể vượt nhẹ trong một chu kỳ; directory tự lành khi shard chết.
   */
  assertCanCreateRoom(owner: User) {
    const owned = [...this.rooms.values()].filter((r) => r.server === owner.server && r.ownerId === owner.id).length;
    if (owned >= LIMITS.roomsPerUser) throw new Error(`Bạn chỉ được tạo tối đa ${LIMITS.roomsPerUser} phòng`);
    if (this.roomList(owner.server).length >= LIMITS.roomsPerServer) throw new Error('Sảnh đã đủ phòng, hãy vào một phòng có sẵn');
  }

  createRoom(owner: User, { name, game, options }: Omit<RoomOptions, 'owner'>) {
    this.assertCanCreateRoom(owner);
    const room = new Room(this, { name, game, owner, options });
    this.rooms.set(room.id, room);
    room.system(`${owner.name} tạo phòng "${name}"`);
    return room;
  }

  /** Vào phòng để chơi ('play') hoặc xem ('watch'). Trả về cảnh báo nếu không ngồi được. */
  join(user: User, room: Room, mode: string) {
    const players = new Set(room.handler.playerIds());
    const spectators = [...room.members].filter((id) => !players.has(id)).length;
    // Reserve actual player admission even when all spectator places are occupied.
    // Attempt the seat before leaving the previous room, so a rejected join is harmless.
    if (!room.members.has(user.id) && !players.has(user.id) && spectators >= LIMITS.spectatorsPerRoom) {
      if (mode !== 'play') throw new Error('Phòng đã đủ người xem');
      try { room.handler.sit(user); }
      catch { throw new Error('Phòng đã đủ người xem'); }
    }
    if (user.roomId && user.roomId !== room.id) this.leave(user);
    const isNew = !room.members.has(user.id);
    room.members.add(user.id);
    user.roomId = room.id;
    if (isNew) room.system(`${user.name} vào phòng${mode === 'watch' ? ' (xem)' : ''}`);
    let warning: string | null = null;
    if (mode === 'play' && !room.handler.playerIds().includes(user.id)) {
      try {
        room.handler.sit(user);
      } catch (e) {
        warning = (e instanceof Error ? e.message : String(e)) + ' — bạn đang ở chế độ xem';
      }
    }
    room.changed();
    return warning;
  }

  /**
   * Ra khỏi phòng. Không còn ai đang kết nối trong phòng thì xóa luôn phòng
   * (những người đang mất kết nối chờ vào lại cũng bị đưa ra) để không giữ lại tài nguyên vô ích.
   */
  leave(user: User) {
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
      const next = room.handler.playerIds().find((id: string) => room.members.has(id) && this.isOnline(id))
        || [...room.members].find((id) => this.isOnline(id));
      room.ownerId = next!;
      room.system(`${this.nameOf(next!)} trở thành chủ phòng`);
    }
    room.changed();
  }

  /** Xóa phòng, báo cho mọi thành viên còn lại. */
  close(room: Room, reason: string) {
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
  clearVoice(message: string) {
    for (const room of this.rooms.values()) {
      if (!room.voice.size) continue;
      room.voice.clear();
      room.system(message);
      room.changed();
    }
  }
}
