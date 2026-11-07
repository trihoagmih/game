// Xử lý sự kiện của từng kết nối socket.
import { APP_VERSION, GATED, LIMITS, RECONNECT_GRACE_MS } from './config.js';
import { issueSession } from './auth.js';
import { keyedTokenBucket, tokenBucket, WindowCounter } from './rateLimit.js';
import { cleanName } from './lobby.js';
import { GAMES, isGame } from './games/index.js';
import { cleanSignal } from './voice.js';
import type { GameSocket } from './socketTypes.js';
import type { ClientToServerEvents, RequestEvent, Requests, Response, RouteRedirect } from '@game/shared/contracts';
import type { User } from './lobby.js';

type RateKind = 'chat' | 'create' | 'signal' | 'draw';
type HandlerResult<E extends RequestEvent> = Response<E> | RouteRedirect | void | Promise<Response<E> | RouteRedirect | void>;

const newUsersByIp = new WindowCounter(3600_000);
const createByServer = keyedTokenBucket(LIMITS.createPerServer);
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {object} deps
 * @param {import('./lobby.js').Lobby} deps.lobby
 * @param {import('./voice.js').Voice} deps.voice
 * @param {import('./rateLimit.js').ConnectionCounter} deps.connections
 */
export function handleConnection(socket: GameSocket, { lobby, voice, connections }: { lobby: import('./lobby.js').Lobby; voice: import('./voice.js').Voice; connections: import('./rateLimit.js').ConnectionCounter }) {
  const srv = socket.data.server;
  const ip = socket.data.ip;
  let user: User | null = null;
  connections.inc(ip);
  socket.emit('app:version', { version: APP_VERSION });

  // Giới hạn tần suất theo từng loại sự kiện. Mọi sự kiện (trừ tín hiệu WebRTC) dùng chung bucket "events".
  const buckets = {
    events: tokenBucket(LIMITS.events),
    chat: tokenBucket(LIMITS.chat),
    create: tokenBucket(LIMITS.create),
    signal: tokenBucket(LIMITS.signal),
    draw: tokenBucket(LIMITS.draw),
  };
  let blocked = 0;
  const tooFast = (kind: RateKind | null) => {
    // Tín hiệu WebRTC và nét vẽ đến dồn dập: dùng bucket riêng, không tính vào "events"
    const ok = kind === 'signal' || kind === 'draw' ? buckets[kind]() : buckets.events() && (!kind || buckets[kind]());
    if (ok) return false;
    if (++blocked >= LIMITS.abuseDisconnect) socket.disconnect(true);
    return true;
  };

  /**
   * Đăng ký sự kiện: giới hạn tần suất, kiểm tra dữ liệu, bắt lỗi và trả kết quả qua ack.
   * @param {{ auth?: boolean, kind?: 'chat'|'create'|'signal'|'draw' }} opts auth=false: không cần đăng nhập
   */
  const register = <E extends RequestEvent>(event: E, fn: (payload: Requests[E]) => HandlerResult<E>, { auth = true, kind = null }: { auth?: boolean; kind?: RateKind | null } = {}) => {
    const listener = async (payload: unknown, ack: unknown) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (lobby.frozen) throw new Error('Máy chủ đang cập nhật, hãy kết nối lại');
        if (tooFast(kind)) throw new Error('Thao tác quá nhanh, hãy chậm lại');
        if (payload !== undefined && !isPlainObject(payload)) throw new Error('Dữ liệu không hợp lệ');
        if (auth && !user) throw new Error('Chưa đăng nhập');
        if (auth && user?.transferred) throw new Error('Danh tính đã chuyển sang máy chủ khác');
        if (lobby.cluster && (!lobby.cluster.ready || Date.now() - lobby.cluster.renewedAt > 5000)) throw new Error('Máy chủ đang kết nối lại');
        if (user) user.lastSeen = Date.now();
        const res = await fn((payload || {}) as Requests[E]);
        reply({ ok: true, ...res });
      } catch (e) {
        reply({ ok: false, error: (e instanceof Error && e.message) || 'Lỗi' });
      }
    };
    // Socket.IO also accepts reserved events; registration here is restricted to our wire map.
    socket.on(event as RequestEvent, listener as ClientToServerEvents[RequestEvent]);
  };
  /** Sự kiện cần đăng nhập: handler nhận người dùng đã xác thực. */
  const on = <E extends RequestEvent>(event: E, fn: (payload: Requests[E], me: User) => HandlerResult<E>, opts: { kind?: RateKind | null } = {}) =>
    register(event, (payload) => {
      if (!user) throw new Error('Chưa đăng nhập');
      return fn(payload, user);
    }, opts);
  const ownedRoom = (me: User, message: string) => {
    const room = lobby.currentRoom(me);
    if (room.ownerId !== me.id) throw new Error(message);
    return room;
  };

  // ---------- Danh tính ----------

  register('hello', async ({ token, tokens, name }) => {
    // Mỗi server một danh tính riêng: tokens = { [serverId]: token }
    const identityToken = (isPlainObject(tokens) && tokens[srv.id]) || token;
    let u = lobby.findUser(identityToken, srv.id);
    if (lobby.cluster) {
      const identity = await lobby.cluster.identity(identityToken, srv.id);
      if (identity) u = lobby.importUser(identity);
    }
    if (!u) {
      const nm = cleanName(name);
      if (!nm) throw new Error('Hãy nhập tên');
      if (newUsersByIp.count(ip) >= LIMITS.newUsersPerIpPerHour) throw new Error('Tạo quá nhiều danh tính, hãy thử lại sau');
      if (lobby.users.size >= LIMITS.maxUsers) throw new Error('Máy chủ đang quá tải, hãy thử lại sau');
      newUsersByIp.add(ip);
      u = lobby.createUser(nm, srv.id);
    }
    if (lobby.cluster) {
      await lobby.cluster.saveIdentity(u);
      const nodeId = await lobby.cluster.claimUser(u);
      if (nodeId !== lobby.cluster.nodeId) return { redirect: { nodeId } };
    }
    u.transferred = false;
    if (user && user !== u) user.sockets.delete(socket.id); // gọi hello lần nữa với danh tính khác
    clearTimeout(u.graceTimer ?? undefined);
    u.lastSeen = Date.now();
    u.sockets.add(socket.id);
    user = u;
    socket.join('u:' + u.id);
    socket.join('lobby:' + srv.id);
    const room = u.roomId && lobby.rooms.get(u.roomId);
    if (room) room.changed();
    lobby.broadcast(srv.id); // báo cho sảnh: có người vừa online
    return {
      user: { id: u.id, name: u.name },
      token: u.token,
      roomId: room ? room.id : null,
      rooms: lobby.roomList(srv.id),
      online: lobby.onlineList(srv.id),
      server: { id: srv.id, name: srv.name, gated: GATED },
      voice: voice.status(srv.name),
      session: issueSession(srv), // gia hạn phiên mỗi lần vào
    };
  }, { auth: false });

  on('user:rename', ({ name }, me) => {
    const nm = cleanName(name);
    if (!nm) throw new Error('Tên không hợp lệ');
    const old = me.name;
    me.name = nm;
    const room = me.roomId && lobby.rooms.get(me.roomId);
    if (room) {
      room.handler.rename(me.id, nm);
      room.system(`${old} đổi tên thành ${nm}`);
      room.changed();
    }
    lobby.broadcast(me.server);
    return { user: { id: me.id, name: nm } };
  });

  // ---------- Sảnh & phòng ----------

  on('lobby:list', (_payload, me) => ({ rooms: lobby.roomList(me.server), online: lobby.onlineList(me.server) }));

  on('room:create', async ({ name, game, options }, me) => {
    if (!isGame(game)) throw new Error('Trò chơi không hợp lệ');
    if (lobby.draining) throw new Error('Máy chủ đang cập nhật, hãy thử lại sau');
    if (lobby.cluster) await lobby.cluster.tick();
    lobby.assertCanCreateRoom(me); // từ chối trước khi chuyển shard hoặc trừ lượt tạo phòng của sảnh
    if (lobby.cluster) {
      const nodeId = lobby.cluster.placement(me.server);
      if (nodeId !== lobby.cluster.nodeId) return lobby.cluster.transfer(me, nodeId);
    }
    // Chỉ tính lượt ở shard thực sự tạo phòng; yêu cầu bị chuyển shard không trừ hai lần.
    if (!createByServer(me.server)) throw new Error('Sảnh đang tạo quá nhiều phòng, hãy thử lại sau');
    const room = lobby.createRoom(me, {
      name: cleanName(name, 40) || `Bàn ${GAMES[game].name} của ${me.name}`,
      game,
      options: isPlainObject(options) ? options : {},
    });
    const warning = lobby.join(me, room, 'play');
    if (lobby.cluster) await lobby.cluster.tick();
    return { roomId: room.id, warning };
  }, { kind: 'create' });

  on('room:join', async ({ roomId, mode }, me) => {
    if (lobby.cluster && !lobby.rooms.has(roomId)) {
      await lobby.cluster.tick();
      const nodeId = lobby.cluster.ownerOfRoom(roomId, me.server);
      if (nodeId && nodeId !== lobby.cluster.nodeId) return lobby.cluster.transfer(me, nodeId);
    }
    const room = lobby.roomFor(me, roomId);
    if (!room) throw new Error('Phòng không tồn tại');
    const warning = lobby.join(me, room, mode === 'watch' ? 'watch' : 'play');
    return { roomId: room.id, warning };
  });

  on('room:leave', (_payload, me) => { lobby.leave(me); });

  on('room:delete', ({ roomId }, me) => {
    const room = lobby.roomFor(me, roomId || me.roomId);
    if (!room) throw new Error('Phòng không tồn tại');
    if (room.ownerId !== me.id) throw new Error('Chỉ chủ phòng mới được xóa');
    lobby.close(room, `Chủ phòng ${me.name} đã xóa phòng`);
  });

  on('room:rename', ({ name }, me) => {
    const room = ownedRoom(me, 'Chỉ chủ phòng mới được đổi tên');
    const nm = cleanName(name, 40);
    if (!nm) throw new Error('Tên phòng không hợp lệ');
    room.name = nm;
    room.system(`Phòng được đổi tên thành "${nm}"`);
    room.changed();
  });

  on('room:sit', ({ seat }, me) => {
    const room = lobby.currentRoom(me);
    room.handler.sit(me, seat);
    room.system(`${me.name} ngồi vào bàn`);
    room.changed();
  });

  on('room:stand', (_payload, me) => {
    const room = lobby.currentRoom(me);
    room.handler.stand(me.id);
    room.system(`${me.name} đứng dậy xem`);
    room.changed();
  });

  on('room:kick', ({ userId }, me) => {
    const room = ownedRoom(me, 'Chỉ chủ phòng mới được mời ra');
    const target = lobby.users.get(userId);
    if (!target || target.roomId !== room.id || target.id === me.id) throw new Error('Không tìm thấy người chơi');
    lobby.toUser(target.id).emit('room:closed', { roomId: room.id, reason: 'Bạn bị chủ phòng mời ra' });
    lobby.leave(target);
  });

  on('room:chat', ({ text }, me) => {
    const room = lobby.currentRoom(me);
    const t = String(text || '').trim().slice(0, 300);
    if (!t) return;
    room.handler.censorChat?.(me.id, t);
    room.addChat({ from: me.id, name: me.name, text: t });
    room.changed();
  }, { kind: 'chat' });

  // ---------- Trò chơi ----------

  on('game:action', (a, me) => {
    const room = lobby.currentRoom(me);
    try {
      room.handler.action(me.id, a);
    } finally {
      room.changed();
    }
  });

  // Truy vấn dữ liệu lớn của game theo yêu cầu (vd: Hands log của Poker) thay vì gửi kèm mỗi lần cập nhật
  on('game:query', (q, me) => {
    const room = lobby.currentRoom(me);
    if (typeof room.handler.query !== 'function') throw new Error('Trò chơi không hỗ trợ');
    return { data: room.handler.query(me.id, q) };
  });

  // Dữ liệu gửi liên tục của game (nét vẽ): chuyển thẳng cho các thành viên khác, không phát lại cả trạng thái phòng
  on('game:stream', (p, me) => {
    const room = lobby.currentRoom(me);
    const out = typeof room.handler.stream === 'function' && room.handler.stream(me.id, p);
    if (!out) return;
    const others = [...room.members].filter((id) => id !== me.id).map((id) => 'u:' + id);
    if (others.length) lobby.io.to(others).emit('game:stream', out);
  }, { kind: 'draw' });

  // ---------- Voice chat ----------

  on('voice:join', async ({ muted }, me) => {
    const room = lobby.currentRoom(me);
    const st = voice.status(srv.name);
    if (!st.enabled) throw new Error(st.reason || 'Voice chat không bật cho server này');
    if (!room.voice.has(me.id) && room.voice.size >= st.maxPerRoom) throw new Error(`Kênh thoại đã đủ ${st.maxPerRoom} người`);
    const iceServers = await voice.iceServers(srv.name);
    if (!lobby.rooms.has(room.id) || me.roomId !== room.id) throw new Error('Bạn đã rời phòng');
    const fresh = !room.voice.has(me.id);
    room.voice.set(me.id, { muted: !!muted, sid: socket.id });
    if (fresh) room.system(`${me.name} vào kênh thoại`);
    room.changed();
    return { iceServers, peers: [...room.voice.keys()].filter((id) => id !== me.id) };
  });

  on('voice:leave', (_payload, me) => {
    const room = me.roomId && lobby.rooms.get(me.roomId);
    if (!room || !room.voice.has(me.id)) return;
    room.voice.delete(me.id);
    room.system(`${me.name} rời kênh thoại`);
    room.changed();
  });

  on('voice:mute', ({ muted }, me) => {
    const room = lobby.currentRoom(me);
    const v = room.voice.get(me.id);
    if (!v) throw new Error('Bạn chưa vào kênh thoại');
    v.muted = !!muted;
    room.changed();
  });

  // Chuyển tiếp SDP / ICE giữa hai người cùng kênh thoại của một phòng (tới đúng tab đang nói chuyện)
  on('voice:signal', ({ to, data }, me) => {
    const room = lobby.currentRoom(me);
    const mine = room.voice.get(me.id);
    const peer = typeof to === 'string' && room.voice.get(to);
    if (!mine || mine.sid !== socket.id || !peer) return;
    const clean = cleanSignal(data);
    if (!clean) throw new Error('Tín hiệu không hợp lệ');
    lobby.io.to(peer.sid).emit('voice:signal', { from: me.id, data: clean });
  }, { kind: 'signal' });

  // ---------- Mất kết nối ----------

  socket.on('disconnect', () => {
    connections.dec(ip);
    if (lobby.frozen) return;
    if (!user) return;
    const u = user;
    u.sockets.delete(socket.id);
    const room = u.roomId && lobby.rooms.get(u.roomId);
    // Tab đang nói chuyện mất kết nối → ra khỏi kênh thoại (âm thanh không thể tiếp tục)
    if (room && room.voice.get(u.id)?.sid === socket.id) {
      room.voice.delete(u.id);
      room.changed();
    }
    if (u.sockets.size) return; // vẫn còn tab khác
    if (room) room.changed();
    lobby.broadcast(u.server); // báo cho sảnh: người này vừa offline
    // Giữ chỗ một lúc để tải lại trang / mạng chập chờn không bị đưa ra khỏi phòng.
    // Danh tính (token) vẫn giữ để lần sau vào lại vẫn giữ tên; dọn sau LIMITS.userIdleMs không hoạt động.
    clearTimeout(u.graceTimer ?? undefined);
    u.graceTimer = setTimeout(() => {
      if (!u.sockets.size) lobby.leave(u);
    }, RECONNECT_GRACE_MS);
  });
}
