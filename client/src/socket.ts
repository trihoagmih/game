import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, RequestEvent, Requests, Response, Ack, GameQuery } from '@game/shared/contracts';
import type { QueryResults } from '@game/shared/views';

// Khi client và server khác domain (vd: GitHub Pages + server riêng), đặt VITE_SERVER_URL lúc build.
const URL = import.meta.env.VITE_SERVER_URL || undefined;
let nodeId = '';
try { nodeId = sessionStorage.getItem('gl_node') || ''; } catch {}
if (!/^[a-z0-9-]{1,24}$/.test(nodeId)) nodeId = '';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(URL, {
  path: nodeId ? `/nodes/${nodeId}/socket.io` : '/socket.io',
  autoConnect: false,
  transports: ['websocket', 'polling'],
  // Phiên đăng nhập (do server cấp) gửi kèm mỗi lần kết nối; mật khẩu chỉ gửi ở lần đăng nhập đầu
  auth: (cb) => cb({ session: storage.session, password: storage.password }),
});

export const AUTH_ERRORS = {
  AUTH_REQUIRED: 'Cần nhập mật khẩu để vào',
  AUTH_FAILED: 'Sai mật khẩu',
  AUTH_LOCKED: 'Nhập sai quá nhiều lần, hãy thử lại sau 10 phút',
  AUTH_BUSY: 'Máy chủ đang tạm khóa đăng nhập do có quá nhiều lần nhập sai, hãy thử lại sau 1 phút',
  TOO_MANY_CONNECTIONS: 'Quá nhiều kết nối từ mạng của bạn, hãy đóng bớt tab rồi thử lại',
};

// Bản cũ lưu mật khẩu dạng chữ thường trong localStorage → xóa đi
try { localStorage.removeItem('gl_pw'); } catch {}
let memoryPassword = '';

/** Gửi sự kiện và chờ phản hồi; ném lỗi nếu server trả về lỗi. */
export function request<E extends RequestEvent>(event: E, ...args: Record<never, never> extends Requests[E] ? [payload?: Requests[E]] : [payload: Requests[E]]): Promise<Response<E>> {
  return send(event, (args[0] === undefined ? {} : args[0]) as Requests[E]);
}

/** Như `request` nhưng luôn có payload — dùng khi tên sự kiện là tham số generic. */
export function send<E extends RequestEvent>(event: E, payload: Requests[E], timeoutMs = 10000): Promise<Response<E>> {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Mất kết nối tới máy chủ'));
    // Socket.IO's mapped tuple cannot preserve the correlation of generic E here.
    const timed = socket.timeout(timeoutMs);
    const emit = timed.emit.bind(timed) as (event: E, payload: Requests[E], ack: (err: Error | null, res: Ack<E>) => void) => void;
    emit(event, payload, (err, res) => {
      if (err) return reject(new Error('Máy chủ không phản hồi'));
      if (!res?.ok) return reject(new Error(res?.error || 'Lỗi'));
      if (res.redirect) {
        const target = res.redirect.nodeId;
        if (!/^[a-z0-9-]{1,24}$/.test(target) || target === nodeId) return reject(new Error('Không thể chuyển máy chủ'));
        try {
          const previous = JSON.parse(sessionStorage.getItem('gl_route_hops') || 'null');
          const hops = previous && Date.now() - previous.at < 30_000 ? previous.count + 1 : 1;
          if (hops > 4) throw new Error('Máy chủ đang cập nhật, hãy thử lại sau');
          sessionStorage.setItem('gl_route_hops', JSON.stringify({ at: Date.now(), count: hops }));
          sessionStorage.setItem('gl_node', target);
          if (event !== 'hello') sessionStorage.setItem('gl_pending_route', JSON.stringify({ event, payload }));
          location.reload();
        } catch (error) { reject(error); }
        return;
      }
      resolve(res);
    });
  });
}

export const storage = {
  get token() { return localStorage.getItem('gl_token') || ''; },
  set token(v: string) { localStorage.setItem('gl_token', v); },
  // Mỗi server một danh tính riêng: { [serverId]: token }
  get tokens(): Record<string, string> {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('gl_tokens') || '{}');
      if (!saved || typeof saved !== 'object') return {};
      return Object.fromEntries(Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === 'string'));
    } catch { return {}; }
  },
  setServerToken(serverId: string, token: string) {
    try { localStorage.setItem('gl_tokens', JSON.stringify({ ...this.tokens, [serverId]: token })); } catch {}
  },
  // Mật khẩu chỉ giữ trong bộ nhớ đến khi đổi được lấy phiên đăng nhập, không bao giờ ghi xuống ổ đĩa
  get password() { return memoryPassword; },
  set password(v: string) { memoryPassword = v || ''; },
  get session() { try { return localStorage.getItem('gl_session') || ''; } catch { return ''; } },
  set session(v: string) { try { if (v) localStorage.setItem('gl_session', v); else localStorage.removeItem('gl_session'); } catch {} },
  get name() { return localStorage.getItem('gl_name') || ''; },
  set name(v: string) { localStorage.setItem('gl_name', v); },
};

/** Truy vấn dữ liệu lớn của game; kiểu kết quả theo loại truy vấn (server trả đúng loại đã hỏi). */
export async function queryGame<Q extends GameQuery>(query: Q): Promise<QueryResults[Q['type']]> {
  const res = await request('game:query', query);
  return res.data as QueryResults[Q['type']];
}
