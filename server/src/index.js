import http from 'node:http';
import fs from 'node:fs';
import { Server } from 'socket.io';
import { APP_VERSION, CLIENT_DIST, CORS_ORIGINS, GATED, PORT, SERVERS, TRUST_PROXY } from './config.js';
import { createApp, originAllowed } from './http.js';
import { authGate } from './auth.js';
import { ConnectionCounter } from './rateLimit.js';
import { Lobby } from './lobby.js';
import { handleConnection } from './connection.js';
import { Voice } from './voice.js';
import { createMetrics } from './metrics.js';
import { clusterFromEnv } from './cluster.js';

// Voice chat: tắt / bật lại (vd. hết hạn mức TURN miễn phí) → báo mọi người, đưa tất cả ra khỏi kênh thoại khi tắt
const voice = new Voice({
  onStatusChange: (st) => {
    for (const s of SERVERS) io.to('lobby:' + s.id).emit('voice:status', voice.status(s.name));
    if (!st.enabled) lobby.clearVoice('Voice chat đã tạm tắt (hết hạn mức miễn phí tháng này)');
  },
});

const server = http.createServer(createApp(voice));
const io = new Server(server, {
  cors: { origin: CORS_ORIGINS.length ? CORS_ORIGINS : false },
  allowRequest: (req, cb) => cb(null, originAllowed(req)),
  maxHttpBufferSize: 16 * 1024, // gói tin lớn nhất client gửi lên (chat 300 ký tự là đủ)
  connectTimeout: 10_000,
});
const lobby = new Lobby(io);
const cluster = clusterFromEnv();
if (cluster) { lobby.cluster = cluster; await cluster.start(lobby); }
const connections = new ConnectionCounter(); // số socket đồng thời theo IP
const metrics = createMetrics();
const metricsTimer = setInterval(() => {
  console.log(JSON.stringify({ event: 'runtime.metrics', ...metrics.snapshot(lobby, io) }));
}, 60_000);
metricsTimer.unref();

io.use(authGate(connections));
io.on('connection', (socket) => handleConnection(socket, { lobby, voice, connections }));

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
