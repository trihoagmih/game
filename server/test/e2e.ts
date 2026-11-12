// Kiểm thử tích hợp: npx tsx server/test/e2e.ts [url]
// Mô phỏng nhiều người chơi kết nối qua Socket.IO tới server đang chạy.
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { request } from './socketClient.js';
import type { TestSocket } from './socketClient.js';
import type { DrawStream, GameAction, GameQuery, Identity, IncomingSignal, RequestEvent, Requests, Response, RoomState, VoiceSignal } from '@game/shared/contracts';
import type { Direction, SnakeInput } from '@game/shared/snake';
import type { FairnessView, GameKind, GameViews, QueryResults } from '@game/shared/views';

const URL = process.argv[2] || 'http://localhost:3001';
const PASSWORD = process.env.APP_PASSWORD || '';
// Mật khẩu của một server khác (khi chạy với APP_SERVERS) để kiểm tra các server tách biệt
const OTHER_PASSWORD = process.env.OTHER_PASSWORD || '';

interface Client {
  s: TestSocket;
  name: string;
  state: RoomState | null;
  user: Identity;
  token: string;
  req<E extends RequestEvent>(ev: E, p?: Requests[E]): Promise<Response<E>>;
  act(a: GameAction): Promise<Response<'game:action'>>;
  query<Q extends GameQuery>(q: Q): Promise<QueryResults[Q['type']]>;
}

function client(name: string, password = PASSWORD): Promise<Client> {
  const s: TestSocket = io(URL, { transports: ['websocket'], forceNew: true, auth: { password } });
  const req = async <E extends RequestEvent>(ev: E, p?: Requests[E]) => {
    try { return await request(s, ev, p ?? ({} as Requests[E])); }
    catch (e) { throw new Error(`${name} ${ev}: ${e instanceof Error ? e.message : e}`, { cause: e }); }
  };
  let state: RoomState | null = null;
  s.on('room:state', (st) => { state = st; });
  let c: Client | null = null;
  // Mỗi lần (kết nối lại) đều chào server, như trình duyệt; lần đầu thì trả về người chơi.
  return new Promise((res) => s.on('connect', async () => {
    const r = await req('hello', { name });
    if (c) { c.user = r.user; c.token = r.token; return; }
    c = {
      s, name, user: r.user, token: r.token, req, act: (a) => req('game:action', a),
      // Server trả đúng loại dữ liệu đã hỏi.
      query: async <Q extends GameQuery>(q: Q) => (await req('game:query', q)).data as QueryResults[Q['type']],
      get state() { return state; },
      set state(v) { state = v; },
    };
    res(c);
  }));
}
/** View của trò `game` mà người chơi đang thấy; báo lỗi nếu chưa nhận trạng thái của phòng trò đó. */
function viewOf<G extends GameKind>(c: Client, game: G): GameViews[G] {
  const room = c.state;
  if (!room || room.game !== game) throw new Error(`${c.name} chưa nhận trạng thái phòng ${game}`);
  // room.game === game nên state đúng là view của G; TypeScript không nối được hai điều kiện generic này.
  return room.state as GameViews[G];
}
/** Bộ bài đã công bố (hết ván). */
const revealed = (f: FairnessView) => !!f && 'leaves' in f;
/** Kiểm chứng xáo bài commit–reveal như trình duyệt làm; trả về số lá được công bố. */
const sha256 = (x: string) => crypto.createHash('sha256').update(x).digest('hex');
function verifyFair(seenCommit: string | undefined, f: FairnessView) {
  assert.ok(seenCommit, 'phải nhận commit lúc đầu ván');
  assert.ok(f && 'leaves' in f, 'hết ván phải công bố bộ bài');
  assert.equal(f.commit, seenCommit, 'commit không đổi');
  assert.equal(f.leaves.length, f.total);
  assert.equal(sha256(f.leaves.join('')), seenCommit, 'leaves băm ra commit');
  for (const { i, card, salt } of f.cards) assert.equal(sha256(`${i}:${card}:${salt}`), f.leaves[i], `lá ${card} khớp`);
  assert.equal(new Set(f.cards.map((x) => x.card)).size, f.cards.length, 'không lá nào trùng');
  return f.cards.length;
}
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Chờ điều kiện đúng; lỗi trong lúc chờ (vd. chưa nhận trạng thái phòng mới) thì thử lại tới hết giờ. */
const until = async (fn: () => unknown, ms = 3000) => {
  const t = Date.now();
  let last: unknown = null;
  while (Date.now() - t < ms) {
    try { if (fn()) return; } catch (e) { last = e; }
    await wait(20);
  }
  throw new Error(`timeout chờ điều kiện${last instanceof Error ? `: ${last.message}` : ''}`);
};

// ---------- Auth gate ----------
if (PASSWORD) {
  const tryConnect = (auth: Record<string, string>) => new Promise<string>((res) => {
    const s: TestSocket = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, auth });
    s.on('connect', () => { s.close(); res('ok'); });
    s.on('connect_error', (e) => { s.close(); res(e.message); });
  });
  assert.equal(await tryConnect({}), 'AUTH_REQUIRED');
  assert.equal(await tryConnect({ password: PASSWORD + 'x' }), 'AUTH_FAILED');
  assert.equal(await tryConnect({ password: PASSWORD }), 'ok');
  console.log('✔ Auth gate OK');

  // Phiên đăng nhập: hello trả session, lần sau vào bằng session không cần mật khẩu
  const session = await new Promise<string>((res, rej) => {
    const s: TestSocket = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { password: PASSWORD } });
    s.on('connect', () => request(s, 'hello', { name: 'Phiên' }).then((r) => res(r.session ?? ''), rej).finally(() => s.close()));
  });
  assert.match(session, /^[\w-]+\.\d+\.[\w-]+$/);
  assert.equal(await tryConnect({ session }), 'ok');
  assert.equal(await tryConnect({ session: session.slice(0, -2) + 'xx' }), 'AUTH_REQUIRED', 'session bị sửa không dùng được');
  const [sid, , sig] = session.split('.');
  assert.equal(await tryConnect({ session: `${sid}.${Date.now() + 1e12}.${sig}` }), 'AUTH_REQUIRED', 'không tự gia hạn được');
  console.log('✔ Phiên đăng nhập OK');

  // X-Forwarded-For giả không vượt được giới hạn đoán mật khẩu (server CI chạy với TRUST_PROXY=1)
  if (process.env.TRUST_PROXY) {
    const spoof = (i: number, real = '203.0.113.7') => ({ 'X-Forwarded-For': `10.0.${i}.${i}, ${real}` });
    const tryXff = (headers: Record<string, string>, auth: Record<string, string>) => new Promise<string>((res) => {
      const s: TestSocket = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, auth, extraHeaders: headers });
      s.on('connect', () => { s.close(); res('ok'); });
      s.on('connect_error', (e) => { s.close(); res(e.message); });
    });
    const got: string[] = [];
    for (let i = 0; i < 11; i++) got.push(await tryXff(spoof(i), { password: 'sai-' + i }));
    assert.equal(got.at(-1), 'AUTH_LOCKED', 'đổi phần đầu XFF vẫn bị khóa: ' + got.join(','));
    assert.equal(await tryXff(spoof(99), { password: PASSWORD }), 'AUTH_LOCKED', 'IP đã khóa thì mật khẩu đúng cũng phải chờ');
    assert.equal(await tryXff(spoof(1, '203.0.113.8'), { password: PASSWORD }), 'ok', 'IP khác không bị ảnh hưởng');
    console.log('✔ Chống giả X-Forwarded-For OK');
  }
}

// ---------- Header bảo mật & Origin ----------
{
  const r = await fetch(URL + '/health');
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  const body = await r.json();
  assert.equal(body.users, undefined, '/health không lộ số người dùng');
  const tryOrigin = (origin: string) => new Promise<string>((res) => {
    const s: TestSocket = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { password: PASSWORD }, extraHeaders: { Origin: origin } });
    s.on('connect', () => { s.close(); res('ok'); });
    s.on('connect_error', (e) => { s.close(); res('ERR ' + e.message); });
  });
  assert.notEqual(await tryOrigin('https://evil.example'), 'ok', 'trang lạ không mở được socket');
  assert.equal(await tryOrigin(new globalThis.URL(URL).origin), 'ok', 'cùng origin thì được');
  console.log('✔ Header bảo mật & kiểm tra Origin OK');
}

// ---------- Giới hạn tần suất ----------
{
  const z = await client('Spam');
  const { roomId } = await z.req('room:create', { name: 'Spam', game: 'caro', options: {} });
  const res = await Promise.all(Array.from({ length: 12 }, (_, i) => z.req('room:chat', { text: 'x' + i }).then(() => 'ok', (e: Error) => e.message)));
  assert.ok(res.filter((x) => x === 'ok').length <= 6, 'chat bị giới hạn');
  assert.ok(res.some((x) => /quá nhanh/.test(x)));
  await assert.rejects(z.req('room:create', { name: 'x', game: 'toString' }), /không hợp lệ/);
  await z.req('room:delete', { roomId });
  z.s.close();
  console.log('✔ Giới hạn tần suất OK');
}

// ---------- Phiên bản (báo bản deploy mới) ----------
{
  const health = await (await fetch(URL + '/health')).json();
  const got = await new Promise<string | null>((res) => {
    const s: TestSocket = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, auth: { password: PASSWORD } });
    s.on('app:version', (v) => { s.close(); res(v.version); });
    s.on('connect_error', (e) => { s.close(); res('ERR ' + e.message); });
  });
  assert.equal(got, health.version, 'server gửi phiên bản khi kết nối, khớp với /health');
  console.log(`✔ Phiên bản OK (${got || 'chưa build client'})`);
}

const [a, b, c, d] = await Promise.all(['An', 'Bình', 'Chi', 'Dũng'].map((n) => client(n)));

// ---------- Cờ tướng ----------
{
  const v = (x: Client) => viewOf(x, 'xiangqi');
  const { roomId } = await a.req('room:create', { name: 'Cờ test', game: 'xiangqi', options: { minutes: 8 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => c.state?.members.length === 3);
  assert.equal(v(c).myColor, null, 'người xem không có màu');
  // Không tự bắt đầu: sẵn sàng rồi chủ phòng (a) bấm bắt đầu
  await assert.rejects(a.act({ type: 'start' }), /Chờ Bình sẵn sàng/);
  await b.act({ type: 'ready' });
  await wait(50);
  assert.equal(v(a).status, 'waiting', 'mọi người sẵn sàng vẫn chưa tự bắt đầu');
  await assert.rejects(b.act({ type: 'start' }), /chủ phòng/);
  await a.act({ type: 'start' });
  await until(() => v(a).status === 'playing');
  const red = v(a).myColor === 'r' ? a : b;
  const black = red === a ? b : a;
  await red.act({ type: 'move', from: 7 * 9 + 7, to: 7 * 9 + 4 }); // P2-5
  await assert.rejects(red.act({ type: 'move', from: 7 * 9 + 1, to: 7 * 9 + 4 }), /lượt/);
  await assert.rejects(c.act({ type: 'resign' }), /xem/);
  // xin đi lại -> đối thủ đồng ý
  await red.act({ type: 'requestUndo' });
  await black.act({ type: 'respond', accept: true });
  await until(() => v(red).moves.length === 0 && v(red).turn === 'r');
  await red.act({ type: 'move', from: 7 * 9 + 7, to: 7 * 9 + 4 });
  // cầu hòa -> từ chối
  await black.act({ type: 'offerDraw' });
  await red.act({ type: 'respond', accept: false });
  await until(() => !v(red).pending);
  await until(() => v(c).moves.length === 1);
  assert.ok(v(c).clocks.r <= 8 * 60000 && v(c).clocks.r > 7 * 60000);
  await black.act({ type: 'resign' });
  await until(() => v(a).status === 'over');
  assert.equal(v(a).result!.winner, 'r');
  // Mỗi người nhận trạng thái riêng: chờ chính người xem (c) nhận xong rồi mới đọc
  await until(() => v(c).score.gameNo === 1);
  const sc = v(c).score;
  assert.equal(sc.gameNo, 1);
  assert.equal(sc.rows[0].id, red.user.id, 'người thắng đứng đầu bảng điểm');
  assert.deepEqual([sc.rows[0].wins, sc.rows[0].points, sc.rows[1].losses, sc.rows[1].points], [1, 1, 1, 0]);
  await assert.rejects(b.act({ type: 'resetScore' }), /chủ phòng/);
  await b.act({ type: 'rematch' });
  await a.act({ type: 'start' });
  await until(() => v(a).status === 'playing' && v(red).status === 'playing');
  assert.notEqual(v(red).myColor, 'r', 'đổi màu khi chơi lại');
  await c.req('room:leave');
  await a.req('room:delete', { roomId });
  await until(() => b.state === null || true);
  console.log('✔ Cờ tướng OK');
}

// ---------- Cờ vua ----------
{
  const v = (x: Client) => viewOf(x, 'chess');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Cờ vua test', game: 'chess', options: { minutes: 10 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => c.state?.members.length === 3);
  assert.equal(v(c).myColor, null, 'người xem không có màu');
  await a.act({ type: 'ready' });
  await b.act({ type: 'ready' });
  await until(() => v(a).status === 'playing');
  const white = v(a).myColor === 'w' ? a : b;
  const black = white === a ? b : a;
  // e2: 6*8+4=52, e4: 4*8+4=36
  await white.act({ type: 'move', from: 52, to: 36, promotion: 'Q' });
  await assert.rejects(white.act({ type: 'move', from: 53, to: 37 }), /lượt/);
  await assert.rejects(c.act({ type: 'resign' }), /xem/);
  // Xin đi lại -> đối thủ đồng ý
  await white.act({ type: 'requestUndo' });
  await black.act({ type: 'respond', accept: true });
  await until(() => v(white).moves.length === 0 && v(white).turn === 'w');
  await white.act({ type: 'move', from: 52, to: 36, promotion: 'Q' });
  // Cầu hòa -> từ chối
  await black.act({ type: 'offerDraw' });
  await white.act({ type: 'respond', accept: false });
  await until(() => !v(white).pending);
  await until(() => v(c).moves.length === 1);
  assert.ok(v(c).clocks.w <= 10 * 60000 && v(c).clocks.w > 9 * 60000);
  await black.act({ type: 'resign' });
  await until(() => v(a).status === 'over');
  assert.equal(v(a).result!.winner, 'w');
  await until(() => v(c).score.gameNo === 1);
  const sc = v(c).score;
  assert.equal(sc.gameNo, 1);
  assert.equal(sc.rows[0].id, white.user.id, 'người thắng đứng đầu bảng điểm');
  assert.deepEqual([sc.rows[0].wins, sc.rows[0].points, sc.rows[1].losses, sc.rows[1].points], [1, 1, 1, 0]);
  await assert.rejects(b.act({ type: 'resetScore' }), /chủ phòng/);
  await a.act({ type: 'rematch' });
  await b.act({ type: 'rematch' });
  await until(() => v(a).status === 'playing');
  assert.notEqual(v(white).myColor, 'w', 'đổi màu khi chơi lại');
  await c.req('room:leave');
  await a.req('room:delete', { roomId });
  await until(() => b.state === null || true);
  console.log('✔ Cờ vua OK');
}


// ---------- Cờ caro ----------
{
  const v = (x: Client) => viewOf(x, 'caro');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Caro test', game: 'caro', options: { size: 15, minutes: 5, blockTwoEnds: true } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => c.state?.members.length === 3);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(a).status === 'playing');
  assert.equal(v(a).size, 15);
  const x = v(a).myColor === 'x' ? a : b;
  const o = x === a ? b : a;
  await x.act({ type: 'move', cell: 7 * 15 + 7 });
  await assert.rejects(x.act({ type: 'move', cell: 0 }), /lượt/);
  await assert.rejects(o.act({ type: 'move', cell: 7 * 15 + 7 }), /đã có quân/);
  await assert.rejects(o.act({ type: 'requestUndo' }), /Không có nước/); // O chưa đi
  await x.act({ type: 'requestUndo' });
  await o.act({ type: 'respond', accept: true });
  await until(() => v(x).moves.length === 0 && v(x).turn === 'x');
  for (let k = 0; k < 4; k++) {
    await x.act({ type: 'move', cell: 7 * 15 + 3 + k });
    await o.act({ type: 'move', cell: 9 * 15 + 3 + k });
  }
  await x.act({ type: 'move', cell: 7 * 15 + 7 });
  await until(() => v(c).status === 'over');
  assert.equal(v(c).result!.winner, 'x');
  assert.equal(v(c).result!.line!.length, 5);
  await b.act({ type: 'ready' });
  await until(() => v(a).ready[v(b).myColor!]);
  await a.act({ type: 'start' });
  await until(() => v(a).status === 'playing' && v(o).status === 'playing');
  assert.equal(v(o).myColor, 'x', 'đổi lượt đi khi chơi lại');
  await o.act({ type: 'offerDraw' });
  await x.act({ type: 'respond', accept: true });
  await until(() => v(c).status === 'over');
  const sc = v(c).score;
  const row = (u: Client) => sc.rows.find((r) => r.id === u.user.id);
  assert.deepEqual([row(x)!.wins, row(x)!.draws, row(x)!.points], [1, 1, 1.5], 'điểm cộng theo người, không theo màu');
  assert.deepEqual([row(o)!.losses, row(o)!.draws, row(o)!.points], [1, 1, 0.5]);
  assert.equal(sc.history.length, 2);
  await a.act({ type: 'resetScore' });
  await until(() => v(c).score.rows.length === 0);
  await c.req('room:leave');
  await a.req('room:delete', { roomId });
  console.log('✔ Cờ caro OK');
}

// ---------- Poker ----------
{
  const v = (x: Client) => viewOf(x, 'poker');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Poker test', game: 'poker', options: { smallBlind: 5, bigBlind: 20, buyIn: 1000, maxSeats: 6 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'play' });
  await until(() => v(a).seats.filter(Boolean).length === 3);
  assert.equal(v(a).started, false, 'poker không tự chia');
  await assert.rejects(a.act({ type: 'start' }), /sẵn sàng/);
  await b.act({ type: 'ready' });
  await c.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(a).hand?.street === 'preflop', 5000);
  assert.deepEqual([v(a).smallBlind, v(a).bigBlind], [5, 20], 'small blind nhập riêng');
  const players = [a, b, c];
  let acted = 0;
  // Chơi vài hành động: ai tới lượt thì call
  while (acted < 12) {
    await until(() => players.some((p) => v(p).options) || v(a).hand!.street === 'done', 8000);
    if (v(a).hand!.street === 'done') break;
    const p = players.find((x) => v(x).options);
    await p!.act({ type: 'act', action: 'call' });
    acted++;
    await wait(30);
  }
  const total = v(a).seats.filter(Boolean).reduce((s, x) => s + x!.chips + x!.bet, 0) + (v(a).hand!.street === 'done' ? 0 : v(a).hand!.pot - v(a).seats.filter(Boolean).reduce((s, x) => s + x!.bet, 0));
  assert.equal(total, 3000);
  // Người xem không thấy bài tẩy người khác
  const hidden = v(a).seats.filter((x) => x && x.id !== a.user.id).every((x) => !x!.hole || x!.hole.every((h) => h === '??') || v(a).hand!.street === 'done');
  assert.ok(hidden, 'không lộ bài');
  // Hands log: chơi tiếp cho hết ván (người đầu tiên tới lượt bỏ bài, còn lại theo/check)
  let folded = false;
  while (!v(a).handLogCount) {
    await until(() => players.some((p) => v(p).options) || v(a).handLogCount, 8000);
    if (v(a).handLogCount) break;
    const p = players.find((x) => v(x).options);
    await p!.act({ type: 'act', action: folded ? 'call' : 'fold' }).catch(() => {});
    folded = true;
    await wait(30);
  }
  for (const p of players) {
    const data = await p.query({ type: 'handLog' });
    assert.equal(data.length, 1);
    const e = data[0];
    assert.equal(e.no, 1);
    assert.equal(e.players.reduce((s, x) => s + x.net, 0), 0, 'tổng lời/lỗ bằng 0');
    assert.ok(e.actions.length >= 3);
    for (const x of e.players) {
      const visible = x.id === p.user.id || !!e.shown[x.seat];
      assert.equal(!!x.hole, visible, `${p.name} chỉ thấy bài của mình và bài đã lật`);
    }
    assert.ok(e.players.some((x) => x.folded && x.id !== p.user.id ? x.hole === null : true));
  }
  // Đổi blind: chỉ chủ phòng; giữa ván thì chờ ván sau
  await assert.rejects(b.act({ type: 'setBlinds', smallBlind: 5, bigBlind: 10 }), /chủ phòng/);
  await assert.rejects(a.act({ type: 'setBlinds', smallBlind: 40, bigBlind: 30 }), /Small blind/);
  await a.act({ type: 'setBlinds', smallBlind: 15, bigBlind: 30 });
  await until(() => v(c).bigBlind === 30 || v(c).nextBlinds?.bigBlind === 30);
  await until(() => v(c).hand?.no === 2 && v(c).bigBlind === 30, 10000);
  assert.equal(v(c).smallBlind, 15);
  await a.req('room:delete', { roomId });
  console.log('✔ Poker OK (Hands log, đổi blind)');
}

// ---------- Poker: rabbit hunt ----------
{
  const v = (x: Client) => viewOf(x, 'poker');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Rabbit test', game: 'poker', options: { bigBlind: 20, buyIn: 1000, maxSeats: 2 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(a).seats.filter(Boolean).length === 2);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(a).hand?.street === 'preflop' && v(b).hand?.street === 'preflop', 5000);
  await until(() => v(c).fair?.commit);
  const commitSeen = v(c).fair!.commit;
  assert.equal(revealed(v(c).fair), false, 'đang chơi thì chưa công bố bộ bài');
  const p = [a, b].find((x) => v(x).options);
  await p!.act({ type: 'act', action: 'fold' });
  await until(() => v(a).canRabbit && v(c).hand?.street === 'done');
  assert.equal(v(c).canRabbit, false, 'người xem không được lật rabbit');
  assert.equal(v(c).hand!.rabbit, null, 'chưa lật thì không lộ bài');
  await assert.rejects(c.act({ type: 'rabbit' }), /xem/);
  await b.act({ type: 'rabbit' });
  await until(() => v(c).hand!.rabbit);
  assert.equal(v(c).hand!.rabbit!.length, 5, 'bỏ bài preflop → lật đủ 5 lá');
  await assert.rejects(a.act({ type: 'rabbit' }), /rồi/);
  const data = await c.query({ type: 'handLog' });
  assert.deepEqual(data[0].rabbit, v(c).hand!.rabbit, 'Hands log ghi rabbit');
  await until(() => revealed(v(c).fair) && revealed(v(b).fair));
  assert.equal(verifyFair(commitSeen, v(c).fair), 5, 'người xem chỉ thấy 5 lá rabbit, bài bỏ vẫn kín');
  assert.equal(verifyFair(commitSeen, v(b).fair), 7, 'người chơi thấy thêm 2 lá tẩy của mình');
  await a.req('room:delete', { roomId });
  // Bàn tắt rabbit hunt
  const { roomId: r2 } = await a.req('room:create', { name: 'No rabbit', game: 'poker', options: { bigBlind: 20, buyIn: 1000, maxSeats: 2, rabbitHunt: false } });
  await b.req('room:join', { roomId: r2, mode: 'play' });
  await until(() => v(a).seats.filter(Boolean).length === 2 && !v(a).started);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(a).hand?.street === 'preflop' && v(a).hand && v(b).hand?.street === 'preflop', 5000);
  await [a, b].find((x) => v(x).options)!.act({ type: 'act', action: 'fold' });
  await until(() => v(a).hand!.street === 'done');
  assert.equal(v(a).canRabbit, false);
  await assert.rejects(a.act({ type: 'rabbit' }), /không cho/);
  await a.req('room:delete', { roomId: r2 });
  console.log('✔ Poker rabbit hunt OK');
}

// ---------- Nhiều server: sảnh và phòng tách biệt ----------
if (OTHER_PASSWORD) {
  const x = await client('Xuân', OTHER_PASSWORD);
  const hx = await x.req('hello', { token: x.token });
  const ha = await a.req('hello', { token: a.token });
  assert.equal(ha.user.id, a.user.id);
  assert.notEqual(hx.server.id, ha.server.id, 'hai mật khẩu vào hai server khác nhau');
  const { roomId: rx } = await x.req('room:create', { name: 'Phòng bên B', game: 'caro', options: {} });
  const { roomId: ra } = await a.req('room:create', { name: 'Phòng bên A', game: 'caro', options: {} });
  const listA = (await a.req('lobby:list')).rooms.map((r) => r.id);
  const listX = (await x.req('lobby:list')).rooms.map((r) => r.id);
  assert.ok(listA.includes(ra) && !listA.includes(rx), 'sảnh A không thấy phòng của B');
  assert.ok(listX.includes(rx) && !listX.includes(ra), 'sảnh B không thấy phòng của A');
  await assert.rejects(x.req('room:join', { roomId: ra, mode: 'watch' }), /không tồn tại/);
  await assert.rejects(a.req('room:join', { roomId: rx, mode: 'watch' }), /không tồn tại/);
  await a.req('room:delete', { roomId: ra });
  await x.req('room:delete', { roomId: rx });
  // Token của server A không dùng được ở server B → thành người dùng mới
  const hx2 = await x.req('hello', { tokens: { [hx.server.id]: ha.token }, token: ha.token, name: 'Xuân' });
  assert.notEqual(hx2.user.id, ha.user.id, 'không mượn được danh tính của server khác');
  x.s.close();
  console.log(`✔ Nhiều server OK (${ha.server.name} / ${hx.server.name})`);
}

// ---------- Sâm lốc ----------
{
  const v = (x: Client) => viewOf(x, 'samloc');
  a.state = b.state = c.state = d.state = null;
  const { roomId } = await a.req('room:create', { name: 'Sâm test', game: 'samloc', options: { maxSeats: 4, unit: 10 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'play' });
  await d.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(d).seats.filter(Boolean).length === 3);
  await assert.rejects(d.act({ type: 'start' }), /chủ phòng/);
  await assert.rejects(a.act({ type: 'start' }), /sẵn sàng/);
  await b.act({ type: 'ready' });
  await c.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => [a, b, c, d].every((p) => v(p).game));
  // Người xem được ngồi chờ ngay khi ván đang diễn ra, vào chơi từ ván sau
  await d.req('room:sit', {});
  await until(() => v(d).mySeat >= 0);
  assert.equal(v(d).game!.me, -1, 'ngồi chờ: không chơi ván đang diễn ra');
  assert.equal(v(d).gameSeats.length, 3);
  const samCommit = v(d).fair!.commit;
  const players = [a, b, c];
  const g0 = v(d).game;
  assert.ok(g0!.players.every((p) => p.hand === null) || g0!.result, 'người xem không thấy bài');
  if (!g0!.result) {
    assert.equal(v(a).game!.players[v(a).game!.me].hand!.length, 10);
    for (const p of players) await p.act({ type: 'sam', yes: false }).catch(() => {});
    await until(() => v(d).game!.phase !== 'sam');
    // Đánh tới khi có người hết bài: đi đầu thì thử lá nhỏ nhất hợp lệ, không thì bỏ lượt
    for (let guard = 0; guard < 200 && !v(d).game!.result; guard++) {
      const turn = v(d).game!.turn;
      const p = players.find((x) => v(x).game!.me === turn)!;
      await until(() => v(p).game!.turn === turn && v(p).game!.phase === 'play' || v(d).game!.result);
      if (v(d).game!.result) break;
      const pg = v(p).game;
      const hand = pg!.players[pg!.me].hand;
      if (pg!.lastPlay) await p!.act({ type: 'pass' });
      else {
        let ok = false;
        for (const card of hand!) { try { await p!.act({ type: 'play', cards: [card] }); ok = true; break; } catch { /* báo 1 */ } }
        assert.ok(ok, 'phải đánh được 1 lá');
      }
      await until(() => v(d).game!.turn !== turn || v(d).game!.result);
    }
  }
  await until(() => v(d).game!.result);
  const r = v(d).game!.result;
  assert.equal(r!.scores.reduce((x, y) => x + y, 0), 0, 'tổng thắng thua bằng 0');
  assert.ok(v(d).game!.players.every((p) => Array.isArray(p.hand)), 'hết ván lật bài');
  assert.equal(verifyFair(samCommit, v(d).fair), 52, 'hết ván công bố cả bộ bài');
  const totals = v(d).seats.filter(Boolean).map((x) => x!.total);
  assert.equal(totals.reduce((x, y) => x + y, 0), 0);
  // Ván sau có cả người vừa ngồi chờ
  for (const p of [b, c, d]) await p.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(d).playing && v(d).game!.me >= 0);
  assert.equal(v(d).game!.players.length, 4);
  await a.req('room:delete', { roomId });
  console.log('✔ Sâm lốc OK —', r!.text);
}

// ---------- Nối từ ----------
{
  const v = (x: Client) => viewOf(x, 'wordchain');
  a.state = b.state = c.state = d.state = null;
  const { roomId } = await a.req('room:create', { name: 'Nối từ test', game: 'wordchain', options: { turnSeconds: 15, lives: 1 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'play' });
  await d.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(d).seats.length === 3);
  for (const p of [b, c]) await p.act({ type: 'ready' });
  await wait(50);
  assert.equal(v(d).status, 'waiting', 'không tự bắt đầu');
  await a.act({ type: 'start' });
  await until(() => v(d).status === 'playing');
  // Người ra từ đầu tiên là ngẫu nhiên: xếp lại x/y/z theo thứ tự lượt thực tế
  const order = [a, b, c];
  const fi = order.findIndex((p) => p.user.id === v(d).game!.currentId);
  assert.ok(fi >= 0, 'người đi đầu là một trong các người chơi');
  const [x, y, z] = [order[fi], order[(fi + 1) % 3], order[(fi + 2) % 3]];
  await assert.rejects(y.act({ type: 'word', text: 'đắng cay' }), /lượt/);
  await assert.rejects(x.act({ type: 'word', text: 'mèo' }), /2 chữ/);
  await assert.rejects(x.act({ type: 'word', text: 'con xyzq' }), /từ điển/);
  await assert.rejects(x.act({ type: 'word', text: 'tành mui' }), /"tành mui" không có trong từ điển/);
  await assert.rejects(d.act({ type: 'word', text: 'đắng cay' }), /xem/);
  await assert.rejects(x.act({ type: 'word', text: 'ao chuôm' }), /quá khó/);
  await x.act({ type: 'word', text: 'Đắng Cay' });
  await until(() => v(d).game!.required === 'cay');
  await assert.rejects(y.act({ type: 'word', text: 'con chó' }), /bắt đầu bằng "cay"/);
  await y.act({ type: 'word', text: 'cay đắng' });
  await assert.rejects(z.act({ type: 'word', text: 'đắng cay' }), /đã được dùng/);
  // Phản đối: x và z cùng phản đối "cay đắng" → gỡ, lượt về y
  await x.act({ type: 'object' });
  await z.act({ type: 'object' });
  await until(() => v(d).game!.total === 1 && v(d).game!.currentId === y.user.id);
  await y.act({ type: 'word', text: 'cay cực' });
  await z.act({ type: 'word', text: 'cực khổ' });
  // Chịu thua dần → người cuối thắng
  await x.act({ type: 'giveup' });
  await y.act({ type: 'giveup' });
  await until(() => v(d).status === 'over');
  assert.equal(v(d).game!.result!.winner, z.user.id);
  assert.deepEqual(v(d).game!.result!.ranking, [z.user.id, y.user.id, x.user.id]);
  assert.equal(v(d).wins[0].id, z.user.id);
  assert.deepEqual(v(d).history[0].words.map((w) => w.s.join(' ')), ['đắng cay', 'cay cực', 'cực khổ'], 'lịch sử lưu cả chuỗi từ của ván');
  await a.req('room:delete', { roomId });
  console.log('✔ Nối từ OK');
}

// ---------- Nối thú ----------
{
  const v = (x: Client) => viewOf(x, 'onet');
  const { findMove } = await import('@game/shared/onet');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Nối thú test', game: 'onet', options: { rows: 5, cols: 5, minutes: 2, hints: 1, shuffles: 1 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(c).seats.length === 2);
  assert.equal(v(c).options.cols, 6, 'tổng số ô lẻ thì tự thêm cột');
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(c).status === 'playing');
  const mine = (p: Client) => v(p).players.find((x) => x.id === p.user.id);
  await until(() => mine(a) && mine(b));
  assert.deepEqual(mine(a)!.grid, mine(b)!.grid, 'mọi người cùng một bàn');
  assert.equal(v(c).players[0].hintsLeft, undefined, 'người xem không thấy lượt gợi ý');
  await assert.rejects(c.act({ type: 'match', a: [0, 0], b: [0, 1] }), /xem/);
  await assert.rejects(a.act({ type: 'match', a: [0, 0], b: [9, 9] }), /không hợp lệ/);
  // Gợi ý: trả về một cặp nối được, lần 2 hết lượt
  await a.act({ type: 'hint' });
  await until(() => mine(a)!.hint);
  await assert.rejects(a.act({ type: 'hint' }), /Hết lượt gợi ý/);
  // a nối hết bàn theo cách tìm nước đi (giống người chơi giỏi)
  for (let i = 0; i < 40 && mine(a)!.left > 0; i++) {
    const seq = mine(a)!.seq;
    const mv = findMove(mine(a)!.grid);
    await a.act({ type: 'match', a: mv![0], b: mv![1] });
    await until(() => mine(a)!.seq > seq);
    await wait(120); // giới hạn tần suất ~15 thao tác/giây: chừa token cho các phần sau
  }
  assert.ok(mine(a)!.done && mine(a)!.finishedAt != null, 'a dọn sạch bàn');
  await assert.rejects(a.act({ type: 'hint' }), /dọn xong/);
  assert.equal(v(c).status, 'playing', 'b còn chơi thì ván chưa xong');
  await b.act({ type: 'giveup' });
  await until(() => v(c).status === 'over');
  assert.equal(v(c).result!.winner, a.user.id);
  assert.deepEqual(v(c).result!.ranking, [a.user.id, b.user.id]);
  assert.equal(v(c).wins[0].id, a.user.id);
  await wait(1500); // cho bucket tần suất của a hồi lại trước các phần sau
  await a.req('room:delete', { roomId });
  console.log('✔ Nối thú OK');
}

// ---------- Nối thú: chế độ cổ điển ----------
{
  const v = (x: Client) => viewOf(x, 'onet');
  const { findMove, SHIFTS } = await import('@game/shared/onet');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Nối thú cổ điển', game: 'onet', options: { mode: 'classic', rows: 4, cols: 4, minutes: 2, hints: 0, shuffles: 0, gravity: true } });
  await until(() => v(a).options);
  assert.equal(v(a).options.mode, 'classic');
  assert.equal(v(a).options.gravity, false, 'cổ điển bỏ qua tuỳ chọn trọng lực');
  await a.act({ type: 'start' });
  await until(() => v(a).status === 'playing');
  const mine = () => v(a).players[0];
  assert.equal(mine().level, 1);
  assert.ok(mine().timeLeft! > 0, 'mỗi người có đồng hồ riêng');
  const levels = v(a).levels;
  assert.equal(levels, SHIFTS.length);
  for (let i = 0; i < 200 && !mine().done; i++) {
    const { seq, level } = mine();
    const mv = findMove(mine().grid);
    await a.act({ type: 'match', a: mv![0], b: mv![1] });
    await until(() => mine().seq > seq);
    if (mine().level > level) {
      assert.equal(mine().shift, SHIFTS[mine().level - 1], 'màn mới đổi kiểu dồn');
      assert.equal(mine().left, 16, 'màn mới có bàn đầy');
    }
    await wait(70);
  }
  await until(() => v(a).status === 'over');
  assert.equal(mine().level, levels);
  assert.ok(mine().finishedAt != null, 'phá đảo');
  await wait(1500);
  await a.req('room:delete', { roomId });
  console.log('✔ Nối thú cổ điển OK');
}

// ---------- Tetris ----------
{
  const v = (x: Client) => viewOf(x, 'tetris');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Tetris test', game: 'tetris', options: { targetLines: 8 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await assert.rejects(a.act({ type: 'start' }), /sẵn sàng/);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(c).status === 'playing');
  const state = v(c);
  assert.equal(state.options.targetLines, 8);
  assert.equal(state.mySeat, -1);
  assert.deepEqual(state.boards[0], state.boards[1]);
  assert.ok(state.round && state.startsAt);
  const drop = { type: 'tetrisInput', input: 'drop', round: state.round } as const;
  await assert.rejects(c.act(drop), /xem/);
  await wait(Math.max(0, state.startsAt - Date.now()) + 25);
  await b.act(drop);
  await until(() => v(c).boards[1]?.grid.some((row) => /[A-Z]/.test(row)));
  await b.req('room:leave', {});
  await until(() => v(c).result?.winnerId === a.user.id);
  await a.req('room:delete', { roomId });
  console.log('✔ Tetris OK');
}

// ---------- Líu lưỡi ----------
{
  const v = (x: Client) => viewOf(x, 'twister');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Líu lưỡi test', game: 'twister', options: { rounds: 1, readSeconds: 10, difficulty: 'hard' } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(c).seats.length === 2);
  assert.deepEqual(v(c).seats.map((x) => x.team), [0, 1], 'tự chia đều hai đội');
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(c).status === 'playing' && v(c).current);
  const first = v(c).current!;
  assert.equal(first.readerId, a.user.id);
  assert.ok(first.text && first.level >= 2);
  assert.equal(first.canVote, false, 'người xem không chấm');
  await assert.rejects(c.act({ type: 'twisterVote', verdict: 'clean', turn: v(c).turnNo }), /không chơi/);
  await assert.rejects(b.act({ type: 'next' }), /lượt bạn/);
  await a.act({ type: 'next' });
  await until(() => v(b).current?.phase === 'judge');
  await b.act({ type: 'twisterVote', verdict: 'clean', turn: v(b).turnNo });
  await until(() => v(c).current?.phase === 'result');
  assert.equal(v(c).scores[0], first.level);
  await b.req('room:leave', {});
  await until(() => v(c).status === 'over');
  assert.equal(v(c).result?.winner, 0);
  assert.equal(v(c).result?.reason, 'forfeit');
  await a.req('room:delete', { roomId });
  console.log('✔ Líu lưỡi OK');
}

// ---------- Rắn săn mồi ----------
{
  const v = (x: Client) => viewOf(x, 'snake');
  const { SnakeGame, W, DIRS, START_LEN } = await import('@game/shared/snake');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Rắn test', game: 'snake', options: { level: 9, maze: 'box', maxSeats: 2 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(c).seats.length === 2);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(c).status === 'playing' && v(c).seed);
  const s0 = v(c);
  assert.equal(s0.tickMs, 70);
  assert.ok(s0.startIn > 2000, 'có đếm ngược trước khi bò');
  const mine = (p: Client) => v(p).players.find((x) => x.id === p.user.id);
  const opts = { seed: s0.seed, maze: 'box', level: 9 };
  // Không cho chạy trước đồng hồ server
  await assert.rejects(b.act({ type: 'sync', tick: 500, inputs: [] }), /lệch/);
  await assert.rejects(c.act({ type: 'sync', tick: 1, inputs: [] }), /xem/);

  // b: máy tham ăn chơi trước ở máy mình, rồi gửi lượt rẽ — server phải ra đúng điểm đó
  const g = new SnakeGame(opts);
  const inputs: SnakeInput[] = [];
  const safe = (d: Direction) => { const n = g.next(g.head, d); return !g.walls.has(n) && !g.snake.slice(0, -1).includes(n); };
  for (let t = 0; t < 50 && g.alive; t++) {
    const fx = g.food % W, fy = Math.floor(g.food / W), hx = g.head % W, hy = Math.floor(g.head / W);
    const want = ([fx > hx && 'right', fx < hx && 'left', fy > hy && 'down', fy < hy && 'up'] as const).filter((d) => d !== false);
    const pick = [...want, ...(Object.keys(DIRS) as Direction[])].find((d) => safe(d) && (d === g.dir || g.turn(d) || false));
    if (pick && pick !== g.dir && g.queue.includes(pick)) inputs.push([g.tick, pick]);
    g.step();
  }
  assert.ok(g.alive, 'máy còn sống sau 50 bước');
  await wait(Math.max(0, s0.startIn + 50 * 70 - 1500));
  await b.act({ type: 'sync', tick: 25, inputs: inputs.filter(([t]) => t < 25) });
  await b.act({ type: 'sync', tick: 50, inputs: inputs.filter(([t]) => t >= 25) });
  await until(() => mine(b)!.tick === 50);
  assert.equal(mine(b)!.score, g.score, 'server phát lại ra đúng điểm');
  assert.deepEqual(mine(b)!.snake, g.snake);
  // room:state tới từng người riêng; chờ view của người xem thay vì giả định nó tới cùng lúc với b
  await until(() => v(c).players.find((x) => x.id === b.user.id)!.length === g.length);
  assert.equal(v(c).players.find((x) => x.id === b.user.id)!.length, g.length, 'người xem thấy rắn của b');

  // a: không rẽ → đi thẳng tới viền phải thì đâm
  await a.act({ type: 'sync', tick: 30, inputs: [] });
  await until(() => mine(a)!.done);
  assert.equal(mine(a)!.dead, true);
  assert.equal(mine(a)!.tick, W - 1 - (START_LEN + 1)); // đầu rắn xuất phát ở cột START_LEN + 1
  await a.act({ type: 'sync', tick: 31, inputs: [] }); // gói đến trễ sau khi chết: bỏ qua êm
  assert.equal(v(c).status, 'playing');
  await b.act({ type: 'giveup' });
  await until(() => v(c).status === 'over');
  const exp = g.score > 0 ? b.user.id : null;
  assert.equal(v(c).result!.winner, exp);
  if (exp) assert.deepEqual(v(c).result!.ranking, [b.user.id, a.user.id]);
  assert.equal(v(c).wins.find((w) => w.id === b.user.id)!.best, g.score);
  await wait(1000);
  await a.req('room:delete', { roomId });
  console.log('✔ Rắn săn mồi OK');
}

// ---------- Bay qua khe & Đào vàng (đua song song, server phát lại) ----------
{
  const { SkyhopGame } = await import('@game/shared/skyhop');
  const { GoldmineGame } = await import('@game/shared/goldmine');
  const sky = (x: Client) => viewOf(x, 'skyhop');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Bay test', game: 'skyhop', options: { level: 1, target: 3, maxSeats: 2 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => sky(c).seats.length === 2);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => sky(c).status === 'playing' && sky(c).seed);
  const s0 = sky(c);
  await assert.rejects(b.act({ type: 'raceSync', tick: 5000, inputs: [] }), /lệch/);
  await assert.rejects(c.act({ type: 'raceSync', tick: 1, inputs: [] }), /xem/);
  // b nảy đều tay ở máy mình; server phải ra đúng độ cao đó
  const local = new SkyhopGame({ seed: s0.seed, level: 1, target: 3 });
  const flaps: [number, 'flap'][] = [];
  for (let t = 0; t < 60; t++) {
    if (t % 18 === 0 && local.command('flap')) flaps.push([local.tick, 'flap']);
    local.step();
  }
  assert.ok(!local.over, 'còn bay sau 60 bước');
  await wait(Math.max(0, s0.startIn + 60 * s0.tickMs));
  await b.act({ type: 'raceSync', tick: 60, inputs: flaps });
  const bird = () => sky(c).players.find((p) => p.id === b.user.id)!;
  await until(() => bird().tick === 60);
  assert.deepEqual([bird().y, bird().vy, bird().accepted], [local.y, local.vy, flaps.length], 'người xem thấy đúng trạng thái server phát lại');
  await a.act({ type: 'giveup' });
  await b.act({ type: 'giveup' });
  await until(() => sky(c).status === 'over');
  assert.equal(sky(c).result!.winner, null);
  await a.req('room:delete', { roomId });
  console.log('✔ Bay qua khe OK');

  const mine = (x: Client) => viewOf(x, 'goldmine');
  a.state = b.state = c.state = null;
  const gold = await a.req('room:create', { name: 'Đào test', game: 'goldmine', options: { levels: 2, maxSeats: 1 } });
  await c.req('room:join', { roomId: gold.roomId, mode: 'watch' });
  await until(() => !!c.state && mine(c).seats.length === 1);
  await a.act({ type: 'start' });
  await until(() => mine(c).status === 'playing' && mine(c).seed);
  const g0 = mine(c);
  const game = new GoldmineGame({ seed: g0.seed, levels: 2 });
  const shots: [number, 'shoot'][] = [];
  while (game.tick < 100) {
    if (game.command('shoot')) shots.push([game.tick, 'shoot']);
    game.step();
  }
  await wait(Math.max(0, g0.startIn + 100 * g0.tickMs));
  await a.act({ type: 'raceSync', tick: 100, inputs: shots });
  await until(() => mine(c).players[0].tick === 100);
  assert.deepEqual(mine(c).players[0].mine, game.snapshot(), 'server phát lại ra đúng mỏ');
  await a.act({ type: 'giveup' });
  await until(() => mine(c).status === 'over');
  await a.req('room:delete', { roomId: gold.roomId });
  console.log('✔ Đào vàng OK');
}

// ---------- Bắn gà ----------
{
  const { ChickenGame } = await import('@game/shared/chicken');
  const chicken = (x: Client) => viewOf(x, 'chicken');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Bắn gà test', game: 'chicken', options: { maxSeats: 2 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => chicken(c).status === 'playing');
  const initial = chicken(c);
  await assert.rejects(c.act({ type: 'raceSync', tick: 1, inputs: [] }), /xem/);
  const local = new ChickenGame({ seed: initial.seed, level: 1 });
  local.command('left');
  while (local.tick < 60) local.step();
  await wait(Math.max(0, initial.startIn + 60 * initial.tickMs));
  await b.act({ type: 'raceSync', gameNo: initial.gameNo, offset: 0, tick: 60, inputs: [[0, 'left']] });
  await until(() => chicken(c).players[1].tick === 60);
  assert.deepEqual(chicken(c).players[1].field, local.view());
  await b.act({ type: 'giveup' });
  await a.act({ type: 'giveup' });
  await until(() => chicken(c).status === 'over');
  await b.req('room:leave', {});
  await a.req('room:delete', { roomId });
  console.log('✔ Bắn gà OK');
}

// ---------- Vẽ đoán ----------
{
  const v = (x: Client) => viewOf(x, 'scribble');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Vẽ test', game: 'scribble', options: { rounds: 1, drawSeconds: 60, customWords: 'bánh bao, nón lá' } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(c).seats.length === 2);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' });
  await until(() => v(c).status === 'playing' && v(c).phase === 'choose');
  const drawer = [a, b].find((p) => p.user.id === v(c).drawerId)!;
  const guesser = drawer === a ? b : a;
  await until(() => v(drawer).choices?.length === 3);
  assert.equal(v(guesser).choices, null, 'người đoán không thấy các từ để chọn');
  await assert.rejects(guesser.act({ type: 'choose', index: 0 }), /lượt/);
  const word = v(drawer).choices![0];
  await drawer!.act({ type: 'choose', index: 0 });
  await until(() => v(guesser).phase === 'draw' && v(drawer).phase === 'draw');
  assert.equal(v(drawer).word, word);
  assert.equal(v(guesser).word, null, 'người đoán không thấy đáp án');
  assert.equal(v(guesser).mask!.replace(/_/g, 'x').length, word.length);
  // Nét vẽ: chuyển thẳng cho người khác (cả người xem), lưu lại cho người vào sau
  const turn = v(drawer).turnNo;
  const recv = Promise.all([guesser, c].map((p) => new Promise<DrawStream>((res) => p.s.once('game:stream', res))));
  drawer!.s.emit('game:stream', { turn, ops: [{ k: 'l', id: 1, c: 1, w: 6, p: [10, 10, 50, 60] }, { k: 'x' }] });
  const [g1, c1] = await recv;
  assert.deepEqual(g1.ops, [{ k: 'l', id: 1, c: 1, w: 6, p: [10, 10, 50, 60] }]);
  assert.deepEqual(c1, g1);
  guesser.s.emit('game:stream', { turn, ops: [{ k: 'c' }] }); // người đoán không vẽ được
  await wait(50);
  assert.equal((await c.query({ type: 'canvas' })).ops.length, 1);
  // Không được nhắc đáp án trong chat; người xem không đoán
  await assert.rejects(drawer!.req('room:chat', { text: `đáp án là ${word}` }), /lộ đáp án/);
  await assert.rejects(c.act({ type: 'guess', text: word }), /Người xem/);
  await assert.rejects(drawer!.act({ type: 'guess', text: word }), /đang vẽ/);
  await guesser.act({ type: 'guess', text: 'zzzz' });
  await until(() => v(c).feed.some((f) => f.kind === 'guess' && f.text === 'zzzz'));
  // Đoán đúng không cần dấu → mọi người đã đoán đúng → lộ đáp án
  await guesser.act({ type: 'guess', text: word.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toUpperCase() });
  await until(() => v(c).phase === 'reveal');
  assert.equal(v(c).word, word);
  const sc = Object.fromEntries(v(c).scores.map((x) => [x.id, x.score]));
  assert.ok(sc[guesser.user.id] > 0 && sc[drawer!.user.id] === 60, 'người đoán và người vẽ đều được điểm');
  await assert.rejects(b.act({ type: 'stop' }), /chủ phòng/);
  await a.act({ type: 'stop' });
  await until(() => v(c).status === 'over');
  assert.equal(v(c).last!.ranking[0].id, guesser.user.id);
  assert.equal(v(c).wins.find((w) => w.id === guesser.user.id)!.wins, 1);
  await a.req('room:delete', { roomId });
  console.log('✔ Vẽ đoán OK');
}

// ---------- Tam sao thất bản ----------
{
  const v = (x: Client) => viewOf(x, 'telephone');
  // Client mới (giới hạn tần suất tính theo kết nối — An / Bình… đã thao tác nhiều ở các phần trên)
  const [a, b, c, d] = await Promise.all(['Tư', 'Năm', 'Sáu', 'Bảy'].map((n) => client(n)));
  const { roomId } = await a.req('room:create', { name: 'Tam sao test', game: 'telephone', options: { writeSeconds: 30, drawSeconds: 60 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await d.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(d).seats.length === 2);
  await b.act({ type: 'ready' });
  await assert.rejects(a.act({ type: 'start' }), /ít nhất 3/);
  await c.req('room:join', { roomId, mode: 'play' });
  await c.act({ type: 'ready' });
  await a.act({ type: 'start' });
  const ps = [a, b, c];
  await until(() => ps.every((p) => v(p).task?.kind === 'text'));
  assert.equal(v(d).task, null, 'người xem không có việc');
  // Bước 1: viết câu (nháp rồi nộp)
  const sentence = { [a.user.id]: 'con mèo đi xe đạp', [b.user.id]: 'ông già câu cá', [c.user.id]: 'máy bay trên biển' };
  await assert.rejects(a.act({ type: 'text', text: '  ', done: true }), /viết một câu/);
  await a.act({ type: 'text', text: sentence[a.user.id], done: false });
  await b.act({ type: 'text', text: sentence[b.user.id], done: true });
  await c.act({ type: 'text', text: sentence[c.user.id], done: true });
  await wait(50);
  assert.equal(v(d).step, 0, 'chưa đủ người nộp thì chưa sang bước');
  await a.act({ type: 'done', done: true });
  // Bước 2: vẽ câu của người khác (không phải câu của mình)
  await until(() => ps.every((p) => v(p).task?.kind === 'draw'));
  for (const p of ps) {
    const t = v(p).task;
    assert.ok(Object.values(sentence).includes(t!.prev!.text ?? '') && t!.prev!.text !== sentence[p.user.id], 'vẽ câu của người khác');
    p.s.emit('game:stream', { turn: v(p).turnNo, ops: [{ k: 'l', id: 1, c: 1, w: 6, p: [10, 10, 100, 100] }] });
  }
  await wait(80);
  assert.equal((await a.query({ type: 'canvas' })).ops.length, 1, 'bản nháp bức vẽ được lưu');
  for (const p of ps) await p.act({ type: 'done', done: true });
  // Bước 3: đoán tranh — chỉ xem được tranh được giao
  await until(() => ps.every((p) => v(p).task?.kind === 'text' && v(p).task!.prev?.kind === 'draw'));
  const mine = v(a).task!.prev!.drawId!;
  const data = await a.query({ type: 'drawing', id: mine });
  assert.equal(data.ops.length, 1);
  const other = v(b).task!.prev!.drawId!;
  await assert.rejects(a.query({ type: 'drawing', id: other }), /Không xem được/);
  await assert.rejects(d.query({ type: 'drawing', id: mine }), /Không xem được/);
  for (const p of ps) await p.act({ type: 'text', text: 'một bức tranh', done: true });
  // Xem lại: chủ phòng lật từng phần
  await until(() => v(d).status === 'reveal');
  assert.deepEqual(v(d).albums!.map((x) => x.entries.length), [1, 0, 0]);
  await assert.rejects(b.act({ type: 'next' }), /chủ phòng/);
  for (let k = 0; k < 8; k++) { await a.act({ type: 'next' }); await wait(80); }
  await until(() => v(d).albums![2].entries.length === 3);
  assert.equal(v(d).status, 'reveal');
  await a.act({ type: 'next' });
  await until(() => v(d).status === 'over');
  for (const al of v(d).albums!) {
    assert.equal(new Set(al.entries.map((e) => e.by)).size, 3, 'mỗi câu chuyện qua đủ 3 người');
    assert.deepEqual(al.entries.map((e) => e.kind), ['text', 'draw', 'text']);
    assert.equal(al.entries[0].name, al.owner);
  }
  await d.query({ type: 'drawing', id: other }); // hết ván: ai cũng xem được
  await a.req('room:delete', { roomId });
  for (const p of [a, b, c, d]) p.s.close();
  console.log('✔ Tam sao thất bản OK');
}

// ---------- Voice chat: vào/rời kênh, chuyển tín hiệu WebRTC, tắt mic ----------
{
  const h = await fetch(URL + '/health');
  assert.match(h.headers.get('permissions-policy') || '', /microphone=\(self\)/, 'cho phép micro trên trang mình');
  // Chỉ server có tên trong VOICE_SERVERS mới có voice chat (CI: VOICE_SERVERS="Bên A")
  if (OTHER_PASSWORD) {
    const o = await client('Ngoài', OTHER_PASSWORD);
    const hello = await o.req('hello', { name: 'Ngoài' });
    assert.equal(hello.voice.enabled, false, 'server không có trong VOICE_SERVERS thì không có voice');
    const r = await o.req('room:create', { name: 'x', game: 'caro' });
    await assert.rejects(() => o.req('voice:join', { muted: false }), /không bật/);
    await o.req('room:delete', { roomId: r.roomId });
    o.s.close();
  }
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Voice test', game: 'caro' });
  await b.req('room:join', { roomId, mode: 'watch' });
  await c.req('room:join', { roomId, mode: 'watch' });
  const ja = await a.req('voice:join', { muted: false });
  assert.ok(Array.isArray(ja.iceServers) && ja.iceServers.length, 'có ICE server');
  assert.deepEqual(ja.peers, []);
  const jb = await b.req('voice:join', { muted: true });
  assert.deepEqual(jb.peers, [a.user.id]);
  await until(() => c.state?.voice?.length === 2);
  assert.equal(c.state!.voice.find((v) => v.id === b.user.id)!.muted, true);
  // Tín hiệu đi đúng người nhận
  const got = new Promise<IncomingSignal>((res) => b.s.once('voice:signal', res));
  await a.req('voice:signal', { to: b.user.id, data: { description: { type: 'offer', sdp: 'v=0' } } });
  const sig = await got;
  assert.equal(sig.from, a.user.id);
  assert.equal(sig.data.description!.type, 'offer');
  // Người ngoài kênh thoại không gửi / nhận được; dữ liệu rác bị từ chối
  let leaked = false;
  c.s.once('voice:signal', () => { leaked = true; });
  await c.req('voice:signal', { to: a.user.id, data: { candidate: null } });
  // Gói tín hiệu sai định dạng: cố ý vượt kiểu để kiểm tra server tự từ chối lúc chạy.
  await assert.rejects(() => a.req('voice:signal', { to: b.user.id, data: { evil: 1 } as unknown as VoiceSignal }));
  await a.req('voice:signal', { to: c.user.id, data: { candidate: null } });
  await wait(100);
  assert.equal(leaked, false, 'người ngoài kênh không nhận tín hiệu');
  await b.req('voice:mute', { muted: false });
  await until(() => c.state!.voice.find((v) => v.id === b.user.id)?.muted === false);
  await b.req('voice:leave');
  await until(() => c.state!.voice.length === 1);
  // Rời phòng → tự ra khỏi kênh thoại
  await a.req('room:leave');
  await until(() => c.state!.voice.length === 0);
  console.log('✔ Voice chat OK (kênh thoại, chuyển tín hiệu, tắt mic)');
  await b.req('room:leave');
  await c.req('room:leave');
}

// ---------- Tá lả ----------
{
  const v = (x: Client) => viewOf(x, 'tala');
  a.state = b.state = c.state = d.state = null;
  const { roomId } = await a.req('room:create', { name: 'Phỏm test', game: 'tala', options: { maxSeats: 4, unit: 10 } });
  for (const p of [b, c, d]) await p.req('room:join', { roomId, mode: 'play' });
  await until(() => v(a).seats.filter(Boolean).length === 4);
  for (const p of [b, c, d]) await p.act({ type: 'ready' });
  await a.act({ type: 'start' });
  const all = [a, b, c, d];
  await until(() => v(a).game);
  let guard = 0;
  while (!v(a).game!.result && guard++ < 80) {
    const g = v(a).game;
    const p = all.find((x) => x.user.id === g!.players[g!.turn].id)!;
    await until(() => v(p).game?.turn === g!.turn);
    const pg = v(p).game;
    const me = pg!.players[pg!.me];
    if (pg!.phase === 'draw') { await p!.act({ type: pg!.canEat ? 'eat' : 'draw' }); }
    await until(() => v(p).game!.phase !== 'draw' || v(p).game!.result);
    if (v(p).game!.result) break;
    if (v(p).game!.canU) { await p!.act({ type: 'u' }); break; }
    if (v(p).game!.phase === 'lay') await p!.act({ type: 'autoLay' });
    await wait(30);
    const g2 = v(p).game;
    const mine = g2!.players[g2!.me];
    // đánh lá: thử từng lá đến khi hợp lệ
    let ok = false;
    for (const card of mine.hand!.filter((x) => !mine.eaten.includes(x))) {
      try { await p!.act({ type: 'discard', card }); ok = true; break; } catch { /* thử lá khác */ }
    }
    assert.ok(ok, 'phải đánh được 1 lá');
    await wait(30);
    void me;
  }
  await until(() => v(a).game!.result);
  const r = v(a).game!.result;
  assert.equal(r!.scores.reduce((x, y) => x + y, 0), 0);
  console.log('✔ Tá lả OK —', r!.type === 'u' ? 'Ù' : 'Nhất: ' + v(a).game!.players[r!.winner].name);
  await a.req('room:delete', { roomId });
}

// ---------- Chơi với máy: Cờ caro ----------
{
  const v = (x: Client) => viewOf(x, 'caro');
  a.state = null;
  const { roomId } = await a.req('room:create', { name: 'Caro máy', game: 'caro', options: { minutes: 5, bot: 'hard' } });
  await until(() => v(a).seats.o?.bot === 'hard');
  assert.equal(v(a).myColor, 'x', 'người tạo bàn ngồi X, máy ngồi O');
  assert.equal(v(a).ready.o, true, 'máy luôn sẵn sàng');
  assert.deepEqual(v(a).waitingFor, [], 'không phải chờ máy');
  const list = await a.req('lobby:list');
  assert.ok(list.rooms.find((r) => r.id === roomId)!.playerNames.some((n) => n.includes('Máy')), 'sảnh hiện tên máy');
  await assert.rejects(a.act({ type: 'addBot', level: 'easy' }), /đã có máy/);
  await a.act({ type: 'start' });
  await until(() => v(a).status === 'playing');
  await a.act({ type: 'move', cell: 7 * 15 + 7 });
  await until(() => v(a).moves.length === 2, 4000);
  assert.equal(v(a).turn, 'x', 'máy đã đi, tới lượt người');
  await a.act({ type: 'requestUndo' }); // máy đồng ý cho đi lại
  await until(() => v(a).moves.length === 0, 4000);
  await a.act({ type: 'move', cell: 7 * 15 + 7 });
  await until(() => v(a).moves.length === 2, 4000);
  await a.act({ type: 'offerDraw' }); // máy từ chối cầu hòa
  await until(() => !v(a).pending, 4000);
  assert.equal(v(a).status, 'playing');
  await a.act({ type: 'resign' });
  await until(() => v(a).status === 'over');
  assert.equal(v(a).result!.winner, 'o');
  await a.act({ type: 'start' }); // máy luôn sẵn sàng chơi lại; chơi lại thì đổi lượt: máy đi trước
  await until(() => v(a).status === 'playing' && v(a).moves.length === 1, 4000);
  assert.equal(v(a).myColor, 'o');
  await a.act({ type: 'resign' });
  await until(() => v(a).status === 'over');
  await a.act({ type: 'removeBot' });
  await until(() => !v(a).seats.x);
  await a.act({ type: 'addBot', level: 'easy' });
  await until(() => v(a).seats.x?.bot === 'easy');
  await a.req('room:delete', { roomId });
  console.log('✔ Cờ caro chơi với máy OK');
}

// ---------- Chơi với máy: Nối từ ----------
{
  const v = (x: Client) => viewOf(x, 'wordchain');
  a.state = null;
  const { roomId } = await a.req('room:create', { name: 'Nối từ máy', game: 'wordchain', options: { turnSeconds: 10, bot: 'medium', bots: 2 } });
  await until(() => v(a).seats.length === 3);
  assert.equal(v(a).seats.filter((x) => x.bot).length, 2);
  await a.act({ type: 'start' });
  await until(() => v(a).status === 'playing');
  await assert.rejects(a.act({ type: 'removeBot', id: v(a).seats.find((x) => x.bot)!.id }), /đang diễn ra/);
  const g = () => v(a).game;
  // Tới lượt mình thì nối, chờ đủ 2 từ của máy
  const start = Date.now();
  while (g()!.chain.filter((w) => w.by.startsWith('bot:')).length < 2 && Date.now() - start < 20000) {
    if (g()!.currentId === a.user.id) {
      const req = g()!.required;
      await a.act({ type: 'word', text: req ? `${req} ${req}` : 'học tập' }).catch(() => a.act({ type: 'giveup' }));
    }
    if (v(a).status !== 'playing') break;
    await wait(50);
  }
  const botWords = g()!.chain.filter((w) => w.by.startsWith('bot:'));
  assert.ok(botWords.length >= 1, 'máy đã nối từ');
  await a.req('room:delete', { roomId });
  console.log('✔ Nối từ chơi với máy OK —', botWords.map((w) => w.text).join(', '));
}

// ---------- Đố vui ----------
{
  const v = (x: Client) => viewOf(x, 'quiz');
  a.state = b.state = c.state = null;
  const { roomId } = await a.req('room:create', { name: 'Đố vui test', game: 'quiz', options: { questions: 3, seconds: 5 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await c.req('room:join', { roomId, mode: 'watch' });
  await until(() => v(c).seats.length === 2);
  assert.equal(v(c).source.type, 'builtin');
  assert.ok(v(c).bankSize >= 100, 'có bộ câu hỏi soạn sẵn');
  await assert.rejects(b.act({ type: 'loadQuiz', text: '? Hỏi\n- a\n- b' }), /đúng 1 đáp án đúng/);
  await assert.rejects(c.act({ type: 'loadQuiz', text: '? Hỏi\n* a\n- b' }), /người đang chơi hoặc chủ phòng/);
  const QUIZ = '# Bộ của Bình\n? Một cộng một bằng mấy?\n* 2\n- 3\n- 11\n? Mèo kêu thế nào?\n* Meo meo\n- Gâu gâu\n? Nước sôi ở bao nhiêu độ C?\n- 50\n* 100\n- 0\n- 200\n';
  const RIGHT = { 'Một cộng một bằng mấy?': '2', 'Mèo kêu thế nào?': 'Meo meo', 'Nước sôi ở bao nhiêu độ C?': '100' };
  await b.act({ type: 'loadQuiz', text: QUIZ });
  await until(() => v(c).source.type === 'custom');
  const source = v(c).source;
  assert.equal(source.type === 'custom' && source.title, 'Bộ của Bình');
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' }); // chủ phòng bấm Bắt đầu
  await until(() => v(c).status === 'playing');
  for (let k = 0; k < 3; k++) {
    await until(() => v(a).game!.phase === 'question' && v(a).game!.index === k, 5000);
    const g = v(a).game;
    assert.equal(g!.reveal, null, 'client không biết đáp án khi đang hỏi');
    const right = g!.question!.choices.indexOf((RIGHT as Record<string, string>)[g!.question!.q]);
    const wrong = right === 0 ? 1 : 0;
    await a.act({ type: 'answer', choice: right });
    await assert.rejects(a.act({ type: 'answer', choice: wrong }), /đã trả lời/);
    await b.act({ type: 'answer', choice: k === 1 ? right : wrong }); // cả hai đã trả lời → hiện đáp án ngay
    await until(() => v(a).game!.phase === 'reveal' || v(a).status === 'over');
    if (v(a).status === 'over') break;
    assert.equal(v(a).game!.reveal!.answer, right);
    assert.ok(v(a).game!.me!.last!.points > 500, 'trả lời đúng và nhanh được trên 500 điểm');
    if (k < 2) await a.act({ type: 'next' });
  }
  await until(() => v(c).status === 'over', 8000);
  const lb = v(c).game!.leaderboard;
  assert.equal(lb[0].id, a.user.id, 'An đúng cả 3 câu đứng đầu');
  assert.equal(lb[0].correct, 3);
  assert.equal(lb[1].correct, 1);
  assert.ok(lb[0].score > 3 * 900 + 100 + 200, 'có thưởng chuỗi');
  assert.equal(v(c).wins[0].wins, 1);
  assert.equal(v(c).history[0].title, 'Bộ của Bình');
  // Quay về bộ có sẵn, đổi chủ đề
  await a.act({ type: 'useBuiltin', category: 'Lịch sử', questions: 5 });
  await until(() => v(c).source.type === 'builtin' && v(c).options.category === 'Lịch sử');
  await c.req('room:leave');
  await a.req('room:delete', { roomId });
  console.log('✔ Đố vui OK');
}

// ---------- Đoán chữ ----------
{
  const v = (x: Client) => viewOf(x, 'wordguess');
  a.state = b.state = null;
  const { roomId } = await a.req('room:create', { name: 'Đoán chữ test', game: 'wordguess', options: { mode: 'race', minutes: 3 } });
  await b.req('room:join', { roomId, mode: 'play' });
  await until(() => v(a).seats.length === 2);
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' }); // chủ phòng bấm Bắt đầu
  await until(() => v(a).status === 'playing');
  assert.equal(v(a).game!.secret, null, 'không lộ từ bí mật');
  await assert.rejects(a.act({ type: 'guess', text: 'mèo' }), /2 chữ/);
  await assert.rejects(a.act({ type: 'guess', text: 'tành mui' }), /không có trong từ điển/);
  await a.act({ type: 'guess', text: 'học sinh' });
  await assert.rejects(a.act({ type: 'guess', text: 'Học Sinh' }), /Đã đoán/);
  await until(() => v(a).game!.mine!.count === 1);
  const m = v(a).game!.mine!.guesses[0].marks;
  assert.equal(m.length, 2);
  assert.ok(['g', 'y', 'x'].includes(m[0].onset));
  await until(() => v(b).game!.others[0]?.count === 1);
  assert.equal(v(b).game!.others[0].guesses[0].text, undefined, 'đang đua: không thấy chữ của người khác');
  await a.act({ type: 'giveup' });
  await b.act({ type: 'giveup' });
  await until(() => v(a).status === 'over');
  const secret = v(a).game!.secret;
  assert.ok(secret && secret.split(' ').length === 2, 'hết ván thì hiện từ bí mật');
  assert.equal(v(b).game!.others[0].guesses[0].text, 'học sinh', 'hết ván thì thấy chữ');
  // Cùng đoán: chung một bàn, đoán trúng là cả đội thắng
  await a.act({ type: 'setMode', mode: 'coop' });
  await until(() => v(a).options.mode === 'coop');
  await b.act({ type: 'ready' });
  await a.act({ type: 'start' }); // chủ phòng bấm Bắt đầu
  await until(() => v(a).status === 'playing');
  await a.act({ type: 'guess', text: 'học sinh' }).catch(() => {});
  await b.act({ type: 'guess', text: secret }).catch(() => {}); // có thể trùng từ cũ hoặc không trúng: chỉ kiểm tra bàn chung
  await until(() => v(a).game!.shared!.count >= 1);
  assert.equal(v(b).game!.shared!.guesses[0].name, 'An', 'bàn chung thấy ai đoán');
  await a.act({ type: 'giveup' }).catch(() => {});
  await until(() => v(a).status === 'over');
  await a.req('room:delete', { roomId });
  console.log('✔ Đoán chữ OK — từ bí mật ván 1:', secret);
}

// ---------- Dọn phòng trống ----------
{
  const p = await client('Chủ');
  const q = await client('Khách');
  const r = await client('Xem');
  const has = async (id: string) => (await p.req('lobby:list')).rooms.some((x) => x.id === id);

  // Chủ phòng rời khi vẫn còn người → phòng còn, quyền chủ chuyển cho người đang kết nối
  const { roomId } = await p.req('room:create', { name: 'Dọn', game: 'caro', options: {} });
  await q.req('room:join', { roomId, mode: 'play' });
  await r.req('room:join', { roomId, mode: 'watch' });
  r.s.close(); // Xem mất kết nối (vẫn được giữ chỗ để vào lại)
  await until(() => q.state?.members.find((m) => m.id === r.user.id)?.online === false);
  await p.req('room:leave');
  await until(() => q.state?.ownerId === q.user.id);
  assert.ok(await has(roomId), 'còn người thì phòng vẫn còn');

  // Người cuối cùng đang kết nối rời → xóa phòng ngay, kể cả khi còn người đang mất kết nối
  const closed = new Promise<{ roomId: string }>((res) => q.s.once('room:left', res));
  await q.req('room:leave');
  await closed;
  assert.equal(await has(roomId), false, 'không còn ai kết nối thì phòng bị xóa');
  const back = await client('Xem'); // người mất kết nối vào lại: không còn ở phòng cũ
  const again = await back.req('hello', { token: r.token });
  assert.equal(again.user.id, r.user.id);
  assert.equal(again.roomId, null);
  for (const x of [p, q, back]) x.s.close();
  console.log('✔ Dọn phòng trống OK');
}

for (const p of [a, b, c, d]) p.s.close();
console.log('Tất cả kiểm thử tích hợp đều qua');
process.exit(0);
