// Check ICE from this machine. Never prints credentials or candidate IPs.
// TURN is tested only if its server-side environment variables are available.
import { chromium } from '@playwright/test';
import { Voice } from '../src/voice.js';

const voice = new Voice();
const iceServers = await voice.iceServers();
const turn = iceServers.filter((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/.test(u)));
console.log(JSON.stringify({ turnConfigured: !!voice.turn, turnCredentialsIssued: turn.length > 0 }));
const browser = await chromium.launch({ channel: process.argv[2] || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const checks = [
    { name: 'Cloudflare STUN', servers: [{ urls: 'stun:stun.cloudflare.com:3478' }], expected: 'srflx' },
    { name: 'Google STUN', servers: [{ urls: 'stun:stun.l.google.com:19302' }], expected: 'srflx' },
  ];
  if (turn.length) checks.push({ name: 'TURN relay allocation', servers: turn, expected: 'relay' });
  for (const check of checks) {
    const result = await page.evaluate(async ({ servers, expected }) => {
      const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: expected === 'relay' ? 'relay' : 'all' });
      const types = new Set();
      const errors = [];
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return finish();
        types.add(candidate.type);
        if (candidate.type === expected) finish();
      };
      pc.onicecandidateerror = (e) => errors.push({ code: e.errorCode });
      const timer = setTimeout(finish, 12000);
      try {
        pc.createDataChannel('ice-probe');
        await pc.setLocalDescription();
        await done;
        return { ok: types.has(expected), types: [...types], errors };
      } finally { clearTimeout(timer); pc.close(); }
    }, check);
    console.log(JSON.stringify({ name: check.name, ...result }));
  }
  if (!turn.length) console.log('TURN relay allocation skipped: no TURN credentials available in this environment.');
} finally { await browser.close(); }
