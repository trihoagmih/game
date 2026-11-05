import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { XiangqiHandler } from './games/xiangqi.js';
import { PokerHandler } from './games/poker.js';
import { TalaHandler } from './games/tala.js';
import { CaroHandler } from './games/caro.js';
import { SamLocHandler } from './games/samloc.js';
import { WordChainHandler } from './games/wordchain.js';
import { Voice, cleanSignal } from './voice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const CLIENT_DIST = process.env.CLIENT_DIST || path.resolve(__dirname, '../../client/dist');
// Các origin khác được phép kết nối (vd client trên GitHub Pages), cách nhau dấu phẩy.
// Không đặt = chỉ cho phép trang cùng domain với server. '*' = cho tất cả (không khuyến nghị).
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const RECONNECT_GRACE_MS = 60_000;
// Chia app thành nhiều server (sảnh riêng), mỗi server một mật khẩu. Mật khẩu quyết định vào server nào.
//   APP_SERVERS={"Bên A":"mat-khau-A","Bên B":"mat-khau-B"}
// Chỉ một server: APP_PASSWORD=mat-khau. Không đặt gì = một server mở, không cần mật khẩu.
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SERVERS = loadServers();
const GATED = SERVERS.some((s) => s.password);
// Chạy sau reverse proxy (Render, Nginx…): TRUST_PROXY = số proxy phía trước server (1 = một proxy).
// Proxy NỐI IP nó thấy vào CUỐI X-Forwarded-For, còn phần đầu do client tự điền (giả được),
// nên IP thật là phần tử thứ TRUST_PROXY tính từ cuối. true/yes được hiểu là 1.
const TRUST_PROXY = (() => {
  const v = String(process.env.TRUST_PROXY || '').trim();
  if (/^(true|yes)$/i.test(v)) return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
})();
const DEBUG_IP = /^(1|true|yes)$/i.test(process.env.DEBUG_IP || '');
const AUTH_MAX_FAILS = 10; // sai quá số lần này trong cửa sổ → khóa IP
const AUTH_WINDOW_MS = 10 * 60_000;
// Chặn đoán mật khẩu từ nhiều IP cùng lúc: quá ngưỡng này lần sai/phút trên toàn server thì tạm
// không nhận đăng nhập bằng mật khẩu (người đã có phiên đăng nhập vẫn vào bình thường).
const AUTH_GLOBAL_MAX_FAILS = 60;
const AUTH_GLOBAL_WINDOW_MS = 60_000;
const SESSION_TTL_MS = 30 * 24 * 3600_000; // phiên đăng nhập (thay cho lưu mật khẩu ở trình duyệt)

// Giới hạn chống spam / làm cạn tài nguyên
const LIMITS = {
  connPerIp: 30, // số kết nối socket đồng thời mỗi IP
  newUsersPerIpPerHour: 30, // số danh tính mới mỗi IP mỗi giờ
  maxUsers: 5000, // tổng danh tính trong bộ nhớ
  userIdleMs: 24 * 3600_000, // xóa danh tính không hoạt động sau 24 giờ
  roomsPerServer: 200, // tổng số phòng mỗi server (sảnh)
  roomsPerUser: 5,
  // token bucket mỗi socket: [sức chứa, số lượt hồi mỗi giây]
  events: [40, 15],
  chat: [5, 1],
  signal: [120, 40], // tín hiệu WebRTC (ICE candidate đến dồn dập lúc mới kết nối)
  create: [10, 0.5],
  abuseDisconnect: 300, // bị chặn quá chừng này lần → ngắt kết nối
};

const GAMES = {
  xiangqi: { name: 'Cờ tướng', Handler: XiangqiHandler },
  poker: { name: 'Poker', Handler: PokerHandler },
  tala: { name: 'Tá lả', Handler: TalaHandler },
  caro: { name: 'Cờ caro', Handler: CaroHandler },
  samloc: { name: 'Sâm lốc', Handler: SamLocHandler },
  wordchain: { name: 'Nối từ', Handler: WordChainHandler },
};

// Phiên bản client đang được phục vụ (do Vite ghi ra lúc build). Gửi cho trình duyệt khi kết nối
// để báo người dùng tải lại nếu họ đang chạy bản cũ.
let APP_VERSION = null;
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(CLIENT_DIST, 'version.json'), 'utf8')).version || null;
} catch {
  // Chưa build client (chạy dev) → không có phiên bản
}

/** Đọc cấu hình server từ biến môi trường. Sai cấu hình thì dừng hẳn, tránh vô tình mở app không mật khẩu. */
function loadServers() {
  const raw = (process.env.APP_SERVERS || '').trim();
  const idOf = (name) => 's' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 10);
  if (!raw) return [{ id: 'default', name: null, password: APP_PASSWORD || null }];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('APP_SERVERS không phải JSON hợp lệ. Ví dụ: {"Bên A":"mat-khau-A","Bên B":"mat-khau-B"}');
  }
  const list = Array.isArray(parsed)
    ? parsed.map((x) => [x?.name, x?.password])
    : Object.entries(parsed || {});
  const servers = list.map(([name, password]) => {
    const n = String(name ?? '').trim().slice(0, 40);
    const pw = typeof password === 'string' ? password : '';
    if (!n) throw new Error('APP_SERVERS: mỗi server cần có tên');
    if (!pw) throw new Error(`APP_SERVERS: server "${n}" chưa có mật khẩu`);
    return { id: idOf(n), name: n, password: pw };
  });
  if (!servers.length) throw new Error('APP_SERVERS rỗng');
  if (new Set(servers.map((s) => s.name)).size !== servers.length) throw new Error('APP_SERVERS: tên server bị trùng');
  if (new Set(servers.map((s) => s.password)).size !== servers.length) throw new Error('APP_SERVERS: hai server không được trùng mật khẩu');
  return servers;
}

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.get('/health', (_req, res) => res.json({ ok: true, version: APP_VERSION }));
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  // Express 5: ký tự đại diện phải đặt tên (/{*splat}); mọi đường dẫn còn lại trả về trang SPA
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Game server đang chạy. Client chạy riêng bằng Vite (npm run dev).'));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGINS.length ? CORS_ORIGINS : false },
  allowRequest: (req, cb) => cb(null, originAllowed(req)),
  maxHttpBufferSize: 16 * 1024, // gói tin lớn nhất client gửi lên (chat 300 ký tự là đủ)
  connectTimeout: 10_000,
});

// Voice chat: tắt / bật lại (vd. hết hạn mức TURN miễn phí) → báo mọi người, đưa tất cả ra khỏi kênh thoại khi tắt
const voice = new Voice({
  onStatusChange: (st) => {
    for (const s of SERVERS) io.to('lobby:' + s.id).emit('voice:status', voice.status(s.name));
    if (st.enabled) return;
    for (const room of rooms.values()) {
      if (!room.voice.size) continue;
      room.voice.clear();
      room.system('Voice chat đã tạm tắt (hết hạn mức miễn phí tháng này)');
      room.changed();
    }
  },
});

/** Header bảo mật cho mọi phản hồi HTTP (tương đương helmet, không cần thêm thư viện). */
function securityHeaders(req, res, next) {
  const host = String(req.headers.host || '').replace(/[^\w.:\-\[\]]/g, '');
  const ws = host ? ` wss://${host} ws://${host}` : '';
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React đặt style inline qua thuộc tính style
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${ws}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'", // không cho trang khác nhúng app vào iframe (chống clickjacking)
  ].join('; '));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', `camera=(), ${voice.micPolicy}, geolocation=(), payment=(), usb=(), interest-cohort=()`);
  const https = req.secure || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/**
 * Chỉ nhận kết nối từ trang cùng domain hoặc origin được khai báo trong CORS_ORIGIN.
 * Ngăn trang web lạ mở socket tới server bằng trình duyệt của người chơi.
 * (Client không phải trình duyệt — không gửi Origin — vẫn qua được, nhưng vẫn phải có mật khẩu.)
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ---------- Auth gate: kiểm tra mật khẩu ngay khi kết nối socket ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
for (const s of SERVERS) {
  s.hash = s.password ? sha(s.password) : null;
  // Khóa ký phiên suy ra từ mật khẩu: đổi mật khẩu là mọi phiên cũ hết hiệu lực
  s.sessionKey = s.password ? crypto.createHmac('sha256', 'game-lobby/session/v1').update(s.password).digest() : null;
}
const authFails = new Map(); // ip -> { count, until }
let globalFails = { count: 0, since: Date.now() };

/** IP thật của client: phần tử thứ TRUST_PROXY tính từ CUỐI X-Forwarded-For (phần đầu do client tự điền). */
function clientIp(socket) {
  const direct = socket.handshake.address;
  if (!TRUST_PROXY) return direct;
  const xff = String(socket.handshake.headers['x-forwarded-for'] || '');
  const ips = xff.split(',').map((s) => s.trim()).filter(Boolean);
  return ips[ips.length - TRUST_PROXY] || ips[0] || direct;
}

/** Phiên đăng nhập ký HMAC: "<serverId>.<hết hạn>.<chữ ký>" — không cần lưu mật khẩu ở trình duyệt. */
function issueSession(srv) {
  if (!srv.sessionKey) return null;
  const body = `${srv.id}.${Date.now() + SESSION_TTL_MS}`;
  return `${body}.${crypto.createHmac('sha256', srv.sessionKey).update(body).digest('base64url')}`;
}
function verifySession(token) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const [id, exp, sig] = token.split('.');
  const srv = SERVERS.find((s) => s.id === id);
  if (!srv?.sessionKey || !sig || !(Number(exp) > Date.now())) return null;
  const want = crypto.createHmac('sha256', srv.sessionKey).update(`${id}.${exp}`).digest();
  const got = Buffer.from(sig, 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? srv : null;
}

function recordFail(ip, now) {
  if (now - globalFails.since > AUTH_GLOBAL_WINDOW_MS) globalFails = { count: 0, since: now };
  globalFails.count++;
  if (authFails.size >= 50_000 && !authFails.has(ip)) return AUTH_MAX_FAILS; // bảng đầy: coi như bị khóa
  const r = authFails.get(ip) || { count: 0, until: now + AUTH_WINDOW_MS };
  r.count++;
  authFails.set(ip, r);
  return r.count;
}

// Đếm kết nối đồng thời / danh tính mới theo IP
const connByIp = new Map(); // ip -> số socket
const newUsersByIp = new Map(); // ip -> { count, until }

io.use((socket, next) => {
  const ip = clientIp(socket);
  socket.data.ip = ip;
  if (DEBUG_IP) console.log('[ip]', ip, 'xff=', socket.handshake.headers['x-forwarded-for'] || '-', 'addr=', socket.handshake.address);
  if ((connByIp.get(ip) || 0) >= LIMITS.connPerIp) return next(new Error('TOO_MANY_CONNECTIONS'));
  if (!GATED) {
    socket.data.server = SERVERS[0];
    return next();
  }
  // 1) Phiên đăng nhập còn hạn → vào luôn, không cần mật khẩu
  const bySession = verifySession(socket.handshake.auth?.session);
  if (bySession) {
    socket.data.server = bySession;
    return next();
  }
  // 2) Mật khẩu
  const now = Date.now();
  const rec = authFails.get(ip);
  if (rec && rec.until < now) authFails.delete(ip);
  else if (rec && rec.count >= AUTH_MAX_FAILS) return next(new Error('AUTH_LOCKED'));
  const pw = socket.handshake.auth?.password;
  if (typeof pw !== 'string' || !pw || pw.length > 256) return next(new Error('AUTH_REQUIRED'));
  if (now - globalFails.since <= AUTH_GLOBAL_WINDOW_MS && globalFails.count >= AUTH_GLOBAL_MAX_FAILS) {
    return next(new Error('AUTH_BUSY'));
  }
  // So với mọi server (không dừng sớm) để thời gian phản hồi không lộ thông tin
  const h = sha(pw);
  let match = null;
  for (const s of SERVERS) if (crypto.timingSafeEqual(h, s.hash) && !match) match = s;
  if (match) {
    authFails.delete(ip);
    socket.data.server = match;
    return next();
  }
  const count = recordFail(ip, now);
  next(new Error(count >= AUTH_MAX_FAILS ? 'AUTH_LOCKED' : 'AUTH_FAILED'));
});
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of authFails) if (r.until < now) authFails.delete(ip);
  for (const [ip, r] of newUsersByIp) if (r.until < now) newUsersByIp.delete(ip);
}, 60_000).unref();

/** Token bucket: trả về false khi vượt giới hạn. */
function bucket([capacity, perSec]) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * perSec);
    last = now;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };
}

/** @type {Map<string, {id:string, token:string, name:string, sockets:Set<string>, roomId:string|null, graceTimer:any, lastSeen:number}>} */
const users = new Map(); // theo id
const byToken = new Map();
/** @type {Map<string, Room>} */
const rooms = new Map();

const newId = (n = 8) => crypto.randomBytes(n).toString('base64url').slice(0, n);
const cleanName = (s, max = 24) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const isOnline = (id) => (users.get(id)?.sockets.size || 0) > 0;

class Room {
  constructor({ name, game, owner, options }) {
    this.id = newId(6);
    this.server = owner.server; // phòng thuộc server của người tạo
    this.name = name;
    this.game = game;
    this.ownerId = owner.id;
    this.createdAt = Date.now();
    this.members = new Set();
    this.chat = [];
    this.voice = new Map(); // userId -> { muted, sid } — ai đang trong kênh thoại của phòng
    this.handler = new GAMES[game].Handler(this, options || {});
    this._pending = false;
  }

  isOnline(id) { return isOnline(id); }

  system(text) { this._pushChat({ system: true, text }); }

  _pushChat(m) {
    this.chat.push({ ...m, ts: Date.now(), id: newId(6) });
    if (this.chat.length > 100) this.chat.shift();
  }

  /** Gộp các thay đổi trong cùng tick rồi phát trạng thái. */
  changed() {
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => {
      this._pending = false;
      if (!rooms.has(this.id)) return;
      for (const uid of this.members) io.to('u:' + uid).emit('room:state', this.viewFor(uid));
      broadcastLobby(this.server);
    });
  }

  viewFor(uid) {
    const players = new Set(this.handler.playerIds());
    return {
      id: this.id,
      name: this.name,
      game: this.game,
      ownerId: this.ownerId,
      members: [...this.members].map((id) => ({
        id,
        name: users.get(id)?.name || '?',
        role: players.has(id) ? 'player' : 'spectator',
        online: isOnline(id),
      })),
      chat: this.chat.slice(-60),
      voice: [...this.voice].map(([id, v]) => ({ id, muted: v.muted })),
      state: this.handler.view(uid),
      serverTime: Date.now(),
    };
  }

  summary() {
    const players = this.handler.playerIds();
    return {
      id: this.id,
      name: this.name,
      game: this.game,
      gameName: GAMES[this.game].name,
      ownerId: this.ownerId,
      ownerName: users.get(this.ownerId)?.name || '?',
      players: players.length,
      playerNames: players.map((id) => users.get(id)?.name || '?'),
      maxPlayers: this.handler.maxPlayers,
      spectators: this.members.size - players.length,
      playing: this.handler.isPlaying(),
      options: this.handler.options,
      createdAt: this.createdAt,
    };
  }
}

// Mỗi server có sảnh riêng: chỉ thấy phòng của server mình
const lobbyPending = new Set();
function broadcastLobby(serverId) {
  if (lobbyPending.has(serverId)) return;
  lobbyPending.add(serverId);
  setTimeout(() => {
    lobbyPending.delete(serverId);
    io.to('lobby:' + serverId).emit('lobby:rooms', lobbyList(serverId));
  }, 100);
}
const lobbyList = (serverId) => [...rooms.values()]
  .filter((r) => r.server === serverId)
  .map((r) => r.summary())
  .sort((a, b) => b.createdAt - a.createdAt);
/** Phòng theo id, chỉ khi cùng server với người dùng. */
const roomFor = (user, id) => {
  const r = id && rooms.get(id);
  return r && r.server === user.server ? r : null;
};

function deleteRoom(room, reason) {
  room.handler.dispose();
  rooms.delete(room.id);
  for (const uid of room.members) {
    const u = users.get(uid);
    if (u && u.roomId === room.id) u.roomId = null;
    io.to('u:' + uid).emit('room:closed', { roomId: room.id, reason });
  }
  room.members.clear();
  broadcastLobby(room.server);
}

function leaveRoom(user) {
  const room = user.roomId && rooms.get(user.roomId);
  user.roomId = null;
  if (!room) return;
  room.handler.onLeave(user.id);
  room.members.delete(user.id);
  room.voice.delete(user.id);
  io.to('u:' + user.id).emit('room:left', { roomId: room.id });
  if (!room.members.size) return deleteRoom(room, 'Phòng trống');
  room.system(`${user.name} đã rời phòng`);
  if (room.ownerId === user.id) {
    const next = room.handler.playerIds().find((id) => room.members.has(id)) || [...room.members][0];
    room.ownerId = next;
    room.system(`${users.get(next)?.name} trở thành chủ phòng`);
  }
  room.changed();
}

function joinRoom(user, room, mode) {
  if (user.roomId && user.roomId !== room.id) leaveRoom(user);
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

io.on('connection', (socket) => {
  let user = null;
  const srv = socket.data.server;
  const ip = socket.data.ip;
  connByIp.set(ip, (connByIp.get(ip) || 0) + 1);
  socket.emit('app:version', { version: APP_VERSION });

  // Giới hạn tần suất theo từng loại sự kiện
  const limit = { events: bucket(LIMITS.events), chat: bucket(LIMITS.chat), create: bucket(LIMITS.create), signal: bucket(LIMITS.signal) };
  let blocked = 0;
  const tooFast = (kind) => {
    if (kind === 'signal' ? limit.signal() : limit.events() && (!kind || limit[kind]())) return false;
    if (++blocked >= LIMITS.abuseDisconnect) socket.disconnect(true);
    return true;
  };

  // Bọc handler: giới hạn tần suất, bắt lỗi và trả về qua ack
  const on = (event, fn, needUser = true, kind = null) => {
    socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (tooFast(kind)) throw new Error('Thao tác quá nhanh, hãy chậm lại');
        if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) throw new Error('Dữ liệu không hợp lệ');
        if (needUser && !user) throw new Error('Chưa đăng nhập');
        if (user) user.lastSeen = Date.now();
        const res = await fn(payload || {});
        reply({ ok: true, ...(res || {}) });
      } catch (e) {
        reply({ ok: false, error: e.message || 'Lỗi' });
      }
    });
  };

  on('hello', ({ token, tokens, name }) => {
    // Mỗi server một danh tính riêng: tokens = { [serverId]: token }
    const t = (tokens && typeof tokens === 'object' && tokens[srv.id]) || token;
    let u = typeof t === 'string' && byToken.get(t);
    if (u && u.server !== srv.id) u = null;
    const nm = cleanName(name);
    if (!u) {
      if (!nm) throw new Error('Hãy nhập tên');
      const now = Date.now();
      const quota = newUsersByIp.get(ip) || { count: 0, until: now + 3600_000 };
      if (quota.count >= LIMITS.newUsersPerIpPerHour) throw new Error('Tạo quá nhiều danh tính, hãy thử lại sau');
      if (users.size >= LIMITS.maxUsers) throw new Error('Máy chủ đang quá tải, hãy thử lại sau');
      quota.count++;
      newUsersByIp.set(ip, quota);
      u = { id: newId(10), token: crypto.randomBytes(18).toString('base64url'), name: nm, server: srv.id, sockets: new Set(), roomId: null, graceTimer: null, lastSeen: now };
      users.set(u.id, u);
      byToken.set(u.token, u);
    }
    if (user && user !== u) user.sockets.delete(socket.id); // gọi hello lần nữa với danh tính khác
    clearTimeout(u.graceTimer);
    u.lastSeen = Date.now();
    u.sockets.add(socket.id);
    user = u;
    socket.join('u:' + u.id);
    socket.join('lobby:' + srv.id);
    const room = u.roomId && rooms.get(u.roomId);
    if (room) room.changed();
    return {
      user: { id: u.id, name: u.name }, token: u.token, roomId: room ? room.id : null, rooms: lobbyList(srv.id),
      server: { id: srv.id, name: srv.name, gated: GATED },
      voice: voice.status(srv.name),
      session: issueSession(srv), // gia hạn phiên mỗi lần vào
    };
  }, false);

  on('user:rename', ({ name } = {}) => {
    const nm = cleanName(name);
    if (!nm) throw new Error('Tên không hợp lệ');
    const old = user.name;
    user.name = nm;
    const room = user.roomId && rooms.get(user.roomId);
    if (room) {
      room.handler.rename(user.id, nm);
      room.system(`${old} đổi tên thành ${nm}`);
      room.changed();
    }
    broadcastLobby(user.server);
    return { user: { id: user.id, name: nm } };
  });

  on('lobby:list', () => ({ rooms: lobbyList(user.server) }));

  on('room:create', ({ name, game, options }) => {
    if (typeof game !== 'string' || !Object.hasOwn(GAMES, game)) throw new Error('Trò chơi không hợp lệ');
    const nm = cleanName(name, 40) || `Bàn ${GAMES[game].name} của ${user.name}`;
    const mine = [...rooms.values()].filter((r) => r.server === user.server);
    if (mine.filter((r) => r.ownerId === user.id).length >= LIMITS.roomsPerUser) throw new Error(`Bạn chỉ được tạo tối đa ${LIMITS.roomsPerUser} phòng`);
    if (mine.length >= LIMITS.roomsPerServer) throw new Error('Sảnh đã đủ phòng, hãy vào một phòng có sẵn');
    const room = new Room({ name: nm, game, owner: user, options: options && typeof options === 'object' ? options : {} });
    rooms.set(room.id, room);
    room.system(`${user.name} tạo phòng "${nm}"`);
    const warning = joinRoom(user, room, 'play');
    return { roomId: room.id, warning };
  }, true, 'create');

  on('room:join', ({ roomId, mode }) => {
    const room = roomFor(user, roomId);
    if (!room) throw new Error('Phòng không tồn tại');
    const warning = joinRoom(user, room, mode === 'watch' ? 'watch' : 'play');
    return { roomId: room.id, warning };
  });

  on('room:leave', () => { leaveRoom(user); });

  on('room:delete', ({ roomId }) => {
    const room = roomFor(user, roomId || user.roomId);
    if (!room) throw new Error('Phòng không tồn tại');
    if (room.ownerId !== user.id) throw new Error('Chỉ chủ phòng mới được xóa');
    deleteRoom(room, `Chủ phòng ${user.name} đã xóa phòng`);
  });

  on('room:rename', ({ name }) => {
    const room = rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    if (room.ownerId !== user.id) throw new Error('Chỉ chủ phòng mới được đổi tên');
    const nm = cleanName(name, 40);
    if (!nm) throw new Error('Tên phòng không hợp lệ');
    room.name = nm;
    room.system(`Phòng được đổi tên thành "${nm}"`);
    room.changed();
  });

  on('room:sit', ({ seat }) => {
    const room = rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    room.handler.sit(user, seat);
    room.system(`${user.name} ngồi vào bàn`);
    room.changed();
  });

  on('room:stand', () => {
    const room = rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    room.handler.stand(user.id);
    room.system(`${user.name} đứng dậy xem`);
    room.changed();
  });

  on('room:kick', ({ userId }) => {
    const room = rooms.get(user.roomId);
    if (!room || room.ownerId !== user.id) throw new Error('Chỉ chủ phòng mới được mời ra');
    const target = users.get(userId);
    if (!target || target.roomId !== room.id || target.id === user.id) throw new Error('Không tìm thấy người chơi');
    io.to('u:' + target.id).emit('room:closed', { roomId: room.id, reason: 'Bạn bị chủ phòng mời ra' });
    leaveRoom(target);
  });

  on('room:chat', ({ text }) => {
    const room = rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    const t = String(text || '').trim().slice(0, 300);
    if (!t) return;
    room._pushChat({ from: user.id, name: user.name, text: t });
    room.changed();
  }, true, 'chat');

  on('game:action', (a) => {
    const room = rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    try {
      room.handler.action(user.id, a);
    } finally {
      room.changed();
    }
  });

  // Truy vấn dữ liệu lớn của game theo yêu cầu (vd: Hands log của Poker) thay vì gửi kèm mỗi lần cập nhật
  on('game:query', (q) => {
    const room = rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    if (typeof room.handler.query !== 'function') throw new Error('Trò chơi không hỗ trợ');
    return { data: room.handler.query(user.id, q) };
  });

  // ---------- Voice chat ----------
  const voiceRoom = () => {
    const room = rooms.get(user.roomId);
    if (!room) throw new Error('Bạn chưa vào phòng');
    return room;
  };

  on('voice:join', async ({ muted }) => {
    const room = voiceRoom();
    const st = voice.status(srv.name);
    if (!st.enabled) throw new Error(st.reason || 'Voice chat không bật cho server này');
    if (!room.voice.has(user.id) && room.voice.size >= st.maxPerRoom) throw new Error(`Kênh thoại đã đủ ${st.maxPerRoom} người`);
    const iceServers = await voice.iceServers(srv.name);
    if (!rooms.has(room.id) || user.roomId !== room.id) throw new Error('Bạn đã rời phòng');
    const fresh = !room.voice.has(user.id);
    room.voice.set(user.id, { muted: !!muted, sid: socket.id });
    if (fresh) room.system(`${user.name} vào kênh thoại`);
    room.changed();
    return { iceServers, peers: [...room.voice.keys()].filter((id) => id !== user.id) };
  });

  on('voice:leave', () => {
    const room = rooms.get(user.roomId);
    if (!room || !room.voice.has(user.id)) return;
    room.voice.delete(user.id);
    room.system(`${user.name} rời kênh thoại`);
    room.changed();
  });

  on('voice:mute', ({ muted }) => {
    const room = voiceRoom();
    const v = room.voice.get(user.id);
    if (!v) throw new Error('Bạn chưa vào kênh thoại');
    v.muted = !!muted;
    room.changed();
  });

  // Chuyển tiếp SDP / ICE giữa hai người cùng kênh thoại của một phòng (tới đúng tab đang nói chuyện)
  on('voice:signal', ({ to, data }) => {
    const room = voiceRoom();
    const me = room.voice.get(user.id);
    const peer = typeof to === 'string' && room.voice.get(to);
    if (!me || me.sid !== socket.id || !peer) return;
    const clean = cleanSignal(data);
    if (!clean) throw new Error('Tín hiệu không hợp lệ');
    io.to(peer.sid).emit('voice:signal', { from: user.id, data: clean });
  }, true, 'signal');

  socket.on('disconnect', () => {
    const left = (connByIp.get(ip) || 1) - 1;
    if (left > 0) connByIp.set(ip, left);
    else connByIp.delete(ip);
    if (!user) return;
    const u = user;
    u.sockets.delete(socket.id);
    const vroom = u.roomId && rooms.get(u.roomId);
    // Tab đang nói chuyện mất kết nối → ra khỏi kênh thoại (âm thanh không thể tiếp tục)
    if (vroom && vroom.voice.get(u.id)?.sid === socket.id) { vroom.voice.delete(u.id); vroom.changed(); }
    if (u.sockets.size) return;
    const room = u.roomId && rooms.get(u.roomId);
    if (room) room.changed();
    clearTimeout(u.graceTimer);
    u.graceTimer = setTimeout(() => {
      if (u.sockets.size) return;
      leaveRoom(u);
      // Giữ user (token) để lần sau vào lại vẫn giữ tên; dọn sau LIMITS.userIdleMs không hoạt động
    }, RECONNECT_GRACE_MS);
  });
});

// Dọn danh tính lâu không hoạt động để bộ nhớ không tăng mãi
setInterval(() => {
  const cutoff = Date.now() - LIMITS.userIdleMs;
  for (const u of users.values()) {
    if (u.sockets.size || u.roomId || u.lastSeen > cutoff) continue;
    if ([...rooms.values()].some((r) => r.members.has(u.id))) continue;
    users.delete(u.id);
    byToken.delete(u.token);
  }
}, 10 * 60_000).unref();

server.listen(PORT, () => {
  voice.start();
  console.log(`Game server: http://localhost:${PORT}`);
  if (TRUST_PROXY) console.log(`TRUST_PROXY=${TRUST_PROXY}: lấy IP thứ ${TRUST_PROXY} tính từ cuối X-Forwarded-For`);
  if (CORS_ORIGINS.length) console.log(`Cho phép thêm origin: ${CORS_ORIGINS.join(', ')}`);
  if (!GATED) console.log('Auth gate: TẮT — đặt APP_PASSWORD hoặc APP_SERVERS để yêu cầu mật khẩu');
  else if (SERVERS[0].name) console.log(`Auth gate: BẬT — ${SERVERS.length} server: ${SERVERS.map((s) => s.name).join(', ')}`);
  else console.log('Auth gate: BẬT (APP_PASSWORD)');
  if (fs.existsSync(CLIENT_DIST)) console.log(`Phục vụ client từ ${CLIENT_DIST} (phiên bản ${APP_VERSION || 'không rõ'})`);
});
