import { io } from 'socket.io-client';

// Khi client và server khác domain (vd: GitHub Pages + server riêng), đặt VITE_SERVER_URL lúc build.
const URL = import.meta.env.VITE_SERVER_URL || undefined;
let nodeId = '';
try { nodeId = sessionStorage.getItem('gl_node') || ''; } catch {}
if (!/^[a-z0-9-]{1,24}$/.test(nodeId)) nodeId = '';

export const socket = io(URL, {
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
export function request(event, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error('Mất kết nối tới máy chủ'));
    socket.timeout(10000).emit(event, payload, (err, res) => {
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
  set token(v) { localStorage.setItem('gl_token', v); },
  // Mỗi server một danh tính riêng: { [serverId]: token }
  get tokens() { try { return JSON.parse(localStorage.getItem('gl_tokens') || '{}') || {}; } catch { return {}; } },
  setServerToken(serverId, token) {
    try { localStorage.setItem('gl_tokens', JSON.stringify({ ...this.tokens, [serverId]: token })); } catch {}
  },
  // Mật khẩu chỉ giữ trong bộ nhớ đến khi đổi được lấy phiên đăng nhập, không bao giờ ghi xuống ổ đĩa
  get password() { return memoryPassword; },
  set password(v) { memoryPassword = v || ''; },
  get session() { try { return localStorage.getItem('gl_session') || ''; } catch { return ''; } },
  set session(v) { try { v ? localStorage.setItem('gl_session', v) : localStorage.removeItem('gl_session'); } catch {} },
  get name() { return localStorage.getItem('gl_name') || ''; },
  set name(v) { localStorage.setItem('gl_name', v); },
};
