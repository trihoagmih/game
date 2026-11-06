import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

function appHarness({ restoredRoom = null, joinFails = false } = {}) {
  const handlers = new Map();
  const values = [];
  let cursor = 0;
  let mounted = false;
  const calls = [];
  const room = { id: 'old-room', state: {} };
  const location = { hash: '#/room/old-room' };
  const context = {
    createContext: () => ({ Provider: 'provider' }),
    useContext() {},
    useState(initial) {
      const i = cursor++;
      if (!mounted) values[i] = initial;
      return [values[i], (next) => { values[i] = typeof next === 'function' ? next(values[i]) : next; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!mounted) values[i] = { current: initial };
      return values[i];
    },
    useCallback: (f) => f,
    useMemo: (f) => f(),
    useEffect: (f) => { if (!mounted) f(); },
    h: (type, props, ...children) => ({ type, props, children }),
    socket: { on: (event, f) => handlers.set(event, f), off() {}, connect() {} },
    request: async (event) => {
      calls.push(event);
      if (event === 'hello') return { server: { id: 'server' }, user: { id: 'new-user', name: 'An' }, roomId: restoredRoom, rooms: [] };
      if (event === 'room:join') {
        if (joinFails) throw new Error('Phòng không tồn tại');
        handlers.get('room:state')(room);
      }
      return {};
    },
    storage: { name: 'An', tokens: {}, setServerToken() {} }, AUTH_ERRORS: {},
    location, window: { addEventListener() {}, removeEventListener() {} },
    performance: { now: () => 1 }, setTimeout: () => 1,
  };
  let source = fs.readFileSync(new URL('../../client/src/store.jsx', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  source = transformSync(source, { loader: 'jsx', jsxFactory: 'h' }).code;
  vm.runInNewContext(`${source}\nthis.provider = AppProvider;`, context);
  const render = () => { cursor = 0; const node = context.provider({ children: null }); mounted = true; return node.props.value; };
  render();
  handlers.get('room:state')(room);
  const before = render();
  assert.equal(before.room.id, 'old-room');
  return { render, before, location, calls, room };
}

test('server restart: missing room returns to lobby instead of leaving stale game mounted', async () => {
  const h = appHarness({ joinFails: true });
  await h.before.hello();
  assert.equal(h.render().room, null);
  assert.equal(h.location.hash, '');
  assert.equal(h.render().phase, 'ready');
});

test('reconnect to live room retains state and does not rejoin', async () => {
  const h = appHarness({ restoredRoom: 'old-room' });
  await h.before.hello();
  assert.equal(h.render().room.id, 'old-room');
  assert.deepEqual(h.calls, ['hello']);
});

test('successful URL join keeps newly received room state', async () => {
  const h = appHarness();
  await h.before.hello();
  assert.equal(h.render().room.id, 'old-room');
  assert.deepEqual(h.calls, ['hello', 'room:join']);
});
