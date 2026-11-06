// Xử lý sự kiện của từng kết nối socket.
import { APP_VERSION, GATED, LIMITS, RECONNECT_GRACE_MS } from './config.js';
import { issueSession } from './auth.js';
import { tokenBucket, WindowCounter } from './rateLimit.js';
import { cleanName } from './lobby.js';
import { GAMES, isGame } from './games/index.js';
import { cleanSignal } from './voice.js';

const newUsersByIp = new WindowCounter(3600_000);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {object} deps
 * @param {import('./lobby.js').Lobby} deps.lobby
 * @param {import('./voice.js').Voice} deps.voice
 * @param {import('./rateLimit.js').ConnectionCounter} deps.connections
 */
export function handleConnection(socket, { lobby, voice, connections }) {
  const srv = socket.data.server;
  const ip = socket.data.ip;
  /** @type {import('./lobby.js').User|null} */
  let user = null;
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
  const tooFast = (kind) => {
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
  const on = (event, fn, { auth = true, kind = null } = {}) => {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (tooFast(kind)) throw new Error('Thao tác quá nhanh, hãy chậm lại');
        if (payload !== undefined && !isPlainObject(payload)) throw new Error('Dữ liệu không hợp lệ');
        if (auth && !user) throw new Error('Chưa đăng nhập');
        if (auth && user?.transferred) throw new Error('Danh tính đã chuyển sang máy chủ khác');
        if (lobby.cluster && (!lobby.cluster.ready || Date.now() - lobby.cluster.renewedAt > 5000)) throw new Error('Máy chủ đang kết nối lại');
        if (user) user.lastSeen = Date.now();
        const res = await fn(payload || {});
        reply({ ok: true, ...res });
      } catch (e) {
        reply({ ok: false, error: e.message || 'Lỗi' });
      }
    });
  };
  const ownedRoom = (message) => {
    const room = lobby.currentRoom(user);
    if (room.ownerId !== user.id) throw new Error(message);
    return room;
  };

  // ---------- Danh tính ----------

  on('hello', async ({ token, tokens, name }) => {
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
    if (user && user !== u) user.sockets.delete(socket.id); // gọi hello lần nữa với danh tính khác
    clearTimeout(u.graceTimer);
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

  on('user:rename', ({ name }) => {
    const nm = cleanName(name);
    if (!nm) throw new Error('Tên không hợp lệ');
    const old = user.name;
    user.name = nm;
    const room = user.roomId && lobby.rooms.get(user.roomId);
    if (room) {
      room.handler.rename(user.id, nm);
      room.system(`${old} đổi tên thành ${nm}`);
      room.changed();
    }
    lobby.broadcast(user.server);
    return { user: { id: user.id, name: nm } };
  });

  // ---------- Sảnh & phòng ----------

  on('lobby:list', () => ({ rooms: lobby.roomList(user.server), online: lobby.onlineList(user.server) }));

  on('room:create', async ({ name, game, options }) => {
    if (!isGame(game)) throw new Error('Trò chơi không hợp lệ');
    if (lobby.draining) throw new Error('Máy chủ đang cập nhật, hãy thử lại sau');
    if (lobby.cluster) {
      await lobby.cluster.tick();
      const nodeId = lobby.cluster.placement();
      if (nodeId !== lobby.cluster.nodeId) return lobby.cluster.transfer(user, nodeId);
    }
    const room = lobby.createRoom(user, {
      name: cleanName(name, 40) || `Bàn ${GAMES[game].name} của ${user.name}`,
      game,
      options: isPlainObject(options) ? options : {},
    });
    const warning = lobby.join(user, room, 'play');
    if (lobby.cluster) await lobby.cluster.tick();
    return { roomId: room.id, warning };
  }, { kind: 'create' });

  on('room:join', async ({ roomId, mode }) => {
    if (lobby.cluster && !lobby.rooms.has(roomId)) {
      await lobby.cluster.tick();
      const nodeId = lobby.cluster.ownerOfRoom(roomId, user.server);
      if (nodeId && nodeId !== lobby.cluster.nodeId) return lobby.cluster.transfer(user, nodeId);
    }
    const room = lobby.roomFor(user, roomId);
    if (!room) throw new Error('Phòng không tồn tại');
    const warning = lobby.join(user, room, mode === 'watch' ? 'watch' : 'play');
    return { roomId: room.id, warning };
  });

  on('room:leave', () => { lobby.leave(user); });

  on('room:delete', ({ roomId }) => {
    const room = lobby.roomFor(user, roomId || user.roomId);
    if (!room) throw new Error('Phòng không tồn tại');
    if (room.ownerId !== user.id) throw new Error('Chỉ chủ phòng mới được xóa');
    lobby.close(room, `Chủ phòng ${user.name} đã xóa phòng`);
  });

  on('room:rename', ({ name }) => {
    const room = ownedRoom('Chỉ chủ phòng mới được đổi tên');
    const nm = cleanName(name, 40);
    if (!nm) throw new Error('Tên phòng không hợp lệ');
    room.name = nm;
    room.system(`Phòng được đổi tên thành "${nm}"`);
    room.changed();
  });

  on('room:sit', ({ seat }) => {
    const room = lobby.currentRoom(user);
    room.handler.sit(user, seat);
    room.system(`${user.name} ngồi vào bàn`);
    room.changed();
  });

  on('room:stand', () => {
    const room = lobby.currentRoom(user);
    room.handler.stand(user.id);
    room.system(`${user.name} đứng dậy xem`);
    room.changed();
  });

  on('room:kick', ({ userId }) => {
    const room = ownedRoom('Chỉ chủ phòng mới được mời ra');
    const target = lobby.users.get(userId);
    if (!target || target.roomId !== room.id || target.id === user.id) throw new Error('Không tìm thấy người chơi');
    lobby.toUser(target.id).emit('room:closed', { roomId: room.id, reason: 'Bạn bị chủ phòng mời ra' });
    lobby.leave(target);
  });

  on('room:chat', ({ text }) => {
    const room = lobby.currentRoom(user);
    const t = String(text || '').trim().slice(0, 300);
    if (!t) return;
    room.handler.censorChat?.(user.id, t);
    room.addChat({ from: user.id, name: user.name, text: t });
    room.changed();
  }, { kind: 'chat' });

  // ---------- Trò chơi ----------

  on('game:action', (a) => {
    const room = lobby.currentRoom(user);
    try {
      room.handler.action(user.id, a);
    } finally {
      room.changed();
    }
  });

  // Truy vấn dữ liệu lớn của game theo yêu cầu (vd: Hands log của Poker) thay vì gửi kèm mỗi lần cập nhật
  on('game:query', (q) => {
    const room = lobby.currentRoom(user);
    if (typeof room.handler.query !== 'function') throw new Error('Trò chơi không hỗ trợ');
    return { data: room.handler.query(user.id, q) };
  });

  // Dữ liệu gửi liên tục của game (nét vẽ): chuyển thẳng cho các thành viên khác, không phát lại cả trạng thái phòng
  on('game:stream', (p) => {
    const room = lobby.currentRoom(user);
    const out = typeof room.handler.stream === 'function' && room.handler.stream(user.id, p);
    if (!out) return;
    const others = [...room.members].filter((id) => id !== user.id).map((id) => 'u:' + id);
    if (others.length) lobby.io.to(others).emit('game:stream', out);
  }, { kind: 'draw' });

  // ---------- Voice chat ----------

  on('voice:join', async ({ muted }) => {
    const room = lobby.currentRoom(user);
    const st = voice.status(srv.name);
    if (!st.enabled) throw new Error(st.reason || 'Voice chat không bật cho server này');
    if (!room.voice.has(user.id) && room.voice.size >= st.maxPerRoom) throw new Error(`Kênh thoại đã đủ ${st.maxPerRoom} người`);
    const iceServers = await voice.iceServers(srv.name);
    if (!lobby.rooms.has(room.id) || user.roomId !== room.id) throw new Error('Bạn đã rời phòng');
    const fresh = !room.voice.has(user.id);
    room.voice.set(user.id, { muted: !!muted, sid: socket.id });
    if (fresh) room.system(`${user.name} vào kênh thoại`);
    room.changed();
    return { iceServers, peers: [...room.voice.keys()].filter((id) => id !== user.id) };
  });

  on('voice:leave', () => {
    const room = user.roomId && lobby.rooms.get(user.roomId);
    if (!room || !room.voice.has(user.id)) return;
    room.voice.delete(user.id);
    room.system(`${user.name} rời kênh thoại`);
    room.changed();
  });

  on('voice:mute', ({ muted }) => {
    const room = lobby.currentRoom(user);
    const v = room.voice.get(user.id);
    if (!v) throw new Error('Bạn chưa vào kênh thoại');
    v.muted = !!muted;
    room.changed();
  });

  // Chuyển tiếp SDP / ICE giữa hai người cùng kênh thoại của một phòng (tới đúng tab đang nói chuyện)
  on('voice:signal', ({ to, data }) => {
    const room = lobby.currentRoom(user);
    const me = room.voice.get(user.id);
    const peer = typeof to === 'string' && room.voice.get(to);
    if (!me || me.sid !== socket.id || !peer) return;
    const clean = cleanSignal(data);
    if (!clean) throw new Error('Tín hiệu không hợp lệ');
    lobby.io.to(peer.sid).emit('voice:signal', { from: user.id, data: clean });
  }, { kind: 'signal' });

  // ---------- Mất kết nối ----------

  socket.on('disconnect', () => {
    connections.dec(ip);
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
    clearTimeout(u.graceTimer);
    u.graceTimer = setTimeout(() => {
      if (!u.sockets.size) lobby.leave(u);
    }, RECONNECT_GRACE_MS);
  });
}
