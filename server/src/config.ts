// Cấu hình server, đọc một lần từ biến môi trường lúc khởi động.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  id: string; name: string | null; password: string | null;
  hash?: Buffer | null; sessionKey?: Buffer | null;
}
const env = process.env;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(env.PORT) || 3001;
export const CLIENT_DIST = env.CLIENT_DIST || path.resolve(__dirname, '../../client/dist');

// Các origin khác được phép kết nối (vd client trên GitHub Pages), cách nhau dấu phẩy.
// Không đặt = chỉ cho phép trang cùng domain với server. '*' = cho tất cả (không khuyến nghị).
export const CORS_ORIGINS = (env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

// Chạy sau reverse proxy (Nginx, Cloudflare Tunnel…): TRUST_PROXY = số proxy phía trước server (1 = một proxy).
// Proxy NỐI IP nó thấy vào CUỐI X-Forwarded-For, còn phần đầu do client tự điền (giả được),
// nên IP thật là phần tử thứ TRUST_PROXY tính từ cuối. true/yes được hiểu là 1.
export const TRUST_PROXY = (() => {
  const v = String(env.TRUST_PROXY || '').trim();
  if (/^(true|yes)$/i.test(v)) return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
})();
export const DEBUG_IP = /^(1|true|yes)$/i.test(env.DEBUG_IP || '');

/** Người chơi mất kết nối được giữ chỗ trong phòng bấy lâu trước khi bị đưa ra. */
export const RECONNECT_GRACE_MS = 60_000;

export const AUTH = {
  maxFails: 10, // sai quá số lần này trong cửa sổ → khóa IP
  windowMs: 10 * 60_000,
  // Chặn đoán mật khẩu từ nhiều IP cùng lúc: quá ngưỡng này lần sai/phút trên toàn server thì tạm
  // không nhận đăng nhập bằng mật khẩu (người đã có phiên đăng nhập vẫn vào bình thường).
  globalMaxFails: 60,
  globalWindowMs: 60_000,
  sessionTtlMs: 30 * 24 * 3600_000, // phiên đăng nhập (thay cho lưu mật khẩu ở trình duyệt)
};

// Giới hạn chống spam / làm cạn tài nguyên
export const LIMITS = {
  connPerIp: 30, // số kết nối socket đồng thời mỗi IP
  newUsersPerIpPerHour: 30, // số danh tính mới mỗi IP mỗi giờ
  maxUsers: 5000, // tổng danh tính trong bộ nhớ
  userIdleMs: 24 * 3600_000, // xóa danh tính không hoạt động sau 24 giờ
  roomsPerServer: 200, // tổng số phòng mỗi server (sảnh), tính trên toàn cluster
  roomsPerUser: 5,
  // Cluster: phòng mới ở lại shard của sảnh cho tới khi shard đó nhiều hơn shard nhẹ nhất từng này phòng
  affinitySlack: 50,
  // token bucket tạo phòng chung cho cả một sảnh trên mỗi shard: [sức chứa, số lượt hồi mỗi giây]
  createPerServer: [30, 0.5],
  spectatorsPerRoom: Math.max(0, Math.min(500, Number.parseInt(env.MAX_SPECTATORS_PER_ROOM || '30', 10) || 0)),
  chatHistory: 100, // số tin nhắn giữ lại mỗi phòng
  // token bucket mỗi socket: [sức chứa, số lượt hồi mỗi giây]
  events: [40, 15],
  chat: [5, 1],
  signal: [120, 40], // tín hiệu WebRTC (ICE candidate đến dồn dập lúc mới kết nối)
  draw: [80, 40], // nét vẽ của trò Vẽ đoán (gửi theo từng đoạn ~25 lần/giây)
  create: [10, 0.5],
  abuseDisconnect: 300, // bị chặn quá chừng này lần → ngắt kết nối
};

/**
 * Chia app thành nhiều server (sảnh riêng), mỗi server một mật khẩu. Mật khẩu quyết định vào server nào.
 *   APP_SERVERS={"Bên A":"mat-khau-A","Bên B":"mat-khau-B"}
 * Chỉ một server: APP_PASSWORD=mat-khau. Không đặt gì = một server mở, không cần mật khẩu.
 * Sai cấu hình thì dừng hẳn, tránh vô tình mở app không mật khẩu.
 */
function loadServers(): ServerConfig[] {
  const raw = (env.APP_SERVERS || '').trim();
  if (!raw) return [{ id: 'default', name: null, password: env.APP_PASSWORD || null }];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('APP_SERVERS không phải JSON hợp lệ. Ví dụ: {"Bên A":"mat-khau-A","Bên B":"mat-khau-B"}');
  }
  const list = Array.isArray(parsed) ? parsed.map((x) => [x?.name, x?.password]) : Object.entries(parsed || {});
  const servers = list.map(([name, password]) => {
    const n = String(name ?? '').trim().slice(0, 40);
    const pw = typeof password === 'string' ? password : '';
    if (!n) throw new Error('APP_SERVERS: mỗi server cần có tên');
    if (!pw) throw new Error(`APP_SERVERS: server "${n}" chưa có mật khẩu`);
    return { id: 's' + crypto.createHash('sha256').update(n).digest('hex').slice(0, 10), name: n, password: pw };
  });
  if (!servers.length) throw new Error('APP_SERVERS rỗng');
  if (new Set(servers.map((s) => s.name)).size !== servers.length) throw new Error('APP_SERVERS: tên server bị trùng');
  if (new Set(servers.map((s) => s.password)).size !== servers.length) throw new Error('APP_SERVERS: hai server không được trùng mật khẩu');
  return servers;
}

/** @type {{id:string, name:string|null, password:string|null}[]} */
export const SERVERS = loadServers();
export const GATED = SERVERS.some((s) => s.password);

/** Phiên bản client đang được phục vụ (Vite ghi ra lúc build) — để báo trình duyệt chạy bản cũ tải lại. */
export const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(CLIENT_DIST, 'version.json'), 'utf8')).version || null;
  } catch {
    return null; // chưa build client (chạy dev)
  }
})();
