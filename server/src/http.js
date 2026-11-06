// Phần HTTP: header bảo mật, /health, phục vụ client đã build.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION, CLIENT_DIST, CORS_ORIGINS, TRUST_PROXY } from './config.js';

/** @param {{ micPolicy: string }} voice quyền micro phụ thuộc voice chat có bật hay không */
export function createApp(voice, { ready = () => true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders(voice));
  app.get('/health', (_req, res) => res.json({ ok: true, version: APP_VERSION }));
  app.get('/ready', (_req, res) => { const ok = ready(); res.status(ok ? 200 : 503).json({ ok }); });
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.send('Game server đang chạy. Client chạy riêng bằng Vite (npm run dev).'));
  }
  return app;
}

/** Header bảo mật cho mọi phản hồi HTTP (tương đương helmet, không cần thêm thư viện). */
function securityHeaders(voice) {
  return (req, res, next) => {
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
  };
}

/**
 * Chỉ nhận kết nối socket từ trang cùng domain hoặc origin được khai báo trong CORS_ORIGIN.
 * Ngăn trang web lạ mở socket tới server bằng trình duyệt của người chơi.
 * (Client không phải trình duyệt — không gửi Origin — vẫn qua được, nhưng vẫn phải có mật khẩu.)
 */
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
