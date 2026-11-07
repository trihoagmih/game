import http from 'node:http';
import fs from 'node:fs';
import { Server } from 'socket.io';
import type { GameServer } from './socketTypes.js';
import { APP_VERSION, CLIENT_DIST, CORS_ORIGINS, GATED, PORT, SERVERS, TRUST_PROXY } from './config.js';
import { createApp, originAllowed } from './http.js';
import { authGate } from './auth.js';
import { ConnectionCounter } from './rateLimit.js';
import { Lobby } from './lobby.js';
import { handleConnection } from './connection.js';
import { Voice } from './voice.js';
import { createMetrics } from './metrics.js';
import { clusterFromEnv } from './cluster.js';
import { Recovery } from './recovery.js';
import { FileRecordBackend, RedisRecordBackend, WorkspaceRecords } from './workspaceRecords.js';
import { botPool } from './botPool.js';

// Voice chat: tắt / bật lại (vd. hết hạn mức TURN miễn phí) → báo mọi người, đưa tất cả ra khỏi kênh thoại khi tắt
const voice = new Voice({
  onStatusChange: (st) => {
    for (const s of SERVERS) io.to('lobby:' + s.id).emit('voice:status', voice.status(s.name));
    if (!st.enabled) lobby.clearVoice('Voice chat đã tạm tắt (hết hạn mức miễn phí tháng này)');
  },
});

let ready = false;
const server = http.createServer(createApp(voice, { ready: () => ready && !lobby.draining && (!cluster || cluster.ready) }));
const io: GameServer = new Server(server, {
  cors: { origin: CORS_ORIGINS.length ? CORS_ORIGINS : false },
  allowRequest: (req, cb) => cb(null, originAllowed(req)),
  maxHttpBufferSize: 16 * 1024, // gói tin lớn nhất client gửi lên (chat 300 ký tự là đủ)
  connectTimeout: 10_000,
});
const lobby = new Lobby(io);
const cluster = clusterFromEnv();
if (cluster) { lobby.cluster = cluster; await cluster.start(lobby); }
const recordBackend = cluster
  ? new RedisRecordBackend(cluster.client, cluster.prefix)
  : new FileRecordBackend(process.env.WORKSPACE_RECORDS_FILE || './data/workspace-records.json');
if (recordBackend instanceof FileRecordBackend) await recordBackend.load();
lobby.records = new WorkspaceRecords(recordBackend, () => {
  for (const room of lobby.rooms.values()) if (room.game === 'skyhop' || room.game === 'goldmine') room.changed();
});
const recordsTimer = setInterval(() => lobby.records.refresh(), 2500);
recordsTimer.unref();
const recovery = cluster ? new Recovery(cluster, lobby, process.env.SNAPSHOT_KEY) : null;
if (recovery) { await recovery.restore(); recovery.start(); }
const connections = new ConnectionCounter(); // số socket đồng thời theo IP
const metrics = createMetrics();
const metricsTimer = setInterval(() => {
  console.log(JSON.stringify({ event: 'runtime.metrics', ...metrics.snapshot(lobby, io) }));
}, 60_000);
metricsTimer.unref();

io.use(authGate(connections));
io.on('connection', (socket) => handleConnection(socket, { lobby, voice, connections }));

server.listen(PORT, () => {
  ready = true;
  voice.start();
  console.log(`Game server: http://localhost:${PORT}`);
  if (TRUST_PROXY) console.log(`TRUST_PROXY=${TRUST_PROXY}: lấy IP thứ ${TRUST_PROXY} tính từ cuối X-Forwarded-For`);
  if (CORS_ORIGINS.length) console.log(`Cho phép thêm origin: ${CORS_ORIGINS.join(', ')}`);
  if (!GATED) console.log('Auth gate: TẮT — đặt APP_PASSWORD hoặc APP_SERVERS để yêu cầu mật khẩu');
  else if (SERVERS[0].name) console.log(`Auth gate: BẬT — ${SERVERS.length} server: ${SERVERS.map((s) => s.name).join(', ')}`);
  else console.log('Auth gate: BẬT (APP_PASSWORD)');
  if (fs.existsSync(CLIENT_DIST)) console.log(`Phục vụ client từ ${CLIENT_DIST} (phiên bản ${APP_VERSION || 'không rõ'})`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  ready = false;
  lobby.draining = true;
  console.log(JSON.stringify({ event: 'server.draining', signal, rooms: lobby.rooms.size }));
  const deadline = setTimeout(() => process.exit(1), 20_000);
  deadline.unref();
  try {
    // Stop all mutations before the final snapshot, including drawing streams and disconnect cleanup.
    lobby.frozen = true;
    for (const room of lobby.rooms.values()) room.handler.dispose();
    for (const user of lobby.users.values()) clearTimeout(user.graceTimer ?? undefined);
    if (cluster) await cluster.tick();
    if (recovery) await recovery.close();
    voice.stop();
    metrics.close();
    clearInterval(metricsTimer);
    await botPool.close();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    if (cluster) await cluster.close();
    clearTimeout(deadline);
    process.exit(0);
  } catch (error) { console.error('[shutdown]', error); process.exit(1); }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
