import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

// CLIENT_DIST được đọc lúc import config, nên phải đặt trước khi import http.ts.
const dist = mkdtempSync(path.join(tmpdir(), 'game-client-dist-'));
mkdirSync(path.join(dist, 'assets'));
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>game</title>');
writeFileSync(path.join(dist, 'version.json'), '{"version":"test"}');
writeFileSync(path.join(dist, 'assets', 'inter-latin-400-normal-abc123.woff2'), 'font');
process.env.CLIENT_DIST = dist;
const { createApp } = await import('../src/http.js');

test('hashed build assets are cached immutably while fixed-name files stay short-lived', async (t) => {
  const server = createApp({ micPolicy: 'microphone=()' }).listen(0);
  t.after(() => { server.close(); rmSync(dist, { recursive: true, force: true }); });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cacheControl = async (url: string) => {
    const res = await fetch(base + url);
    assert.equal(res.status, 200);
    return res.headers.get('cache-control');
  };

  assert.equal(await cacheControl('/assets/inter-latin-400-normal-abc123.woff2'), 'public, max-age=31536000, immutable');
  assert.equal(await cacheControl('/version.json'), 'public, max-age=3600');
  assert.equal(await cacheControl('/index.html'), 'public, max-age=3600');
  assert.equal(await cacheControl('/lobby'), 'public, max-age=0');
});
