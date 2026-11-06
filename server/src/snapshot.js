import crypto from 'node:crypto';
import v8 from 'node:v8';
import { GAMES } from './games/index.js';
import { Room } from './lobby.js';
import { ReadyGate } from './games/ready.js';
import { Scoreboard } from './games/scoreboard.js';
import { DeckCommitments } from './games/fairness.js';
import { PokerGame } from '@game/shared/poker';
import { TalaGame } from '@game/shared/tala';
import { SamLocGame } from '@game/shared/samloc';
import { WordChainGame } from '@game/shared/wordchain';
import { OnetBoard, rng } from '@game/shared/onet';
import { dictionary, isKnownWord, isValidSyllable } from './games/wordchain.js';

const classes = new Map([Room, ReadyGate, Scoreboard, DeckCommitments, PokerGame, TalaGame, SamLocGame,
  WordChainGame, OnetBoard, ...Object.values(GAMES).map((g) => g.Handler)].map((Class) => [Class.name, Class]));
const functions = new Map([['isKnownWord', isKnownWord], ['isValidSyllable', isValidSyllable], ['countNext', dictionary.countNext], ['Math.random', Math.random]]);
const timers = new Set(['timer', 'botTimer', 'turnTimer', 'nextHandTimer', 'graceTimer']);

// Encode explicit registered prototypes and preserve aliases (e.g. fairness.ref === initialDeck).
// Runtime handles, sockets and back-references are rebuilt, never persisted.
export function pack(value) {
  const seen = new Map(), nodes = [];
  function encode(item) {
    if (typeof item === 'function') {
      for (const [name, fn] of functions) if (fn === item) return { fn: name };
      if (typeof item.state === 'function') return { rng: item.state() };
      throw new Error('Unregistered snapshot function');
    }
    if (item === null || typeof item !== 'object') return { value: item };
    if (seen.has(item)) return { ref: seen.get(item) };
    const id = nodes.length;
    seen.set(item, id);
    const node = {};
    nodes.push(node);
    if (item instanceof Map) { node.type = 'Map'; node.entries = [...item].map(([k, v]) => [encode(k), encode(v)]); }
    else if (item instanceof Set) { node.type = 'Set'; node.entries = [...item].map(encode); }
    else if (Array.isArray(item)) { node.type = 'Array'; node.entries = item.map(encode); }
    else {
      node.type = item.constructor?.name || 'Object';
      if (node.type !== 'Object' && !classes.has(node.type)) throw new Error(`Unregistered snapshot class: ${node.type}`);
      node.entries = [];
      for (const [key, data] of Object.entries(item)) {
        if (key === 'lobby' || key === 'room') continue;
        if (timers.has(key)) node.entries.push([key, encode(null)]);
        else if (key === 'hintTimers' || key === 'sockets') node.entries.push([key, encode(key === 'sockets' ? new Set() : [])]);
        else node.entries.push([key, encode(data)]);
      }
    }
    return { ref: id };
  }
  const root = encode(value);
  return v8.serialize({ schema: 1, root, nodes });
}

export function unpack(buffer) {
  const data = v8.deserialize(buffer);
  if (data.schema !== 1 || !Array.isArray(data.nodes)) throw new Error('Unsupported snapshot schema');
  const values = data.nodes.map((node) => {
    if (node.type === 'Map') return new Map();
    if (node.type === 'Set') return new Set();
    if (node.type === 'Array') return [];
    if (node.type === 'Object') return {};
    if (!classes.has(node.type)) throw new Error(`Unknown snapshot class: ${node.type}`);
    return Object.create(classes.get(node.type).prototype);
  });
  function decode(value) {
    if ('value' in value) return value.value;
    if ('fn' in value) { if (!functions.has(value.fn)) throw new Error('Unknown snapshot function'); return functions.get(value.fn); }
    if ('rng' in value) return rng(value.rng);
    if (!Number.isInteger(value.ref) || value.ref < 0 || value.ref >= values.length) throw new Error('Invalid snapshot reference');
    return values[value.ref];
  }
  data.nodes.forEach((node, i) => {
    const target = values[i];
    if (node.type === 'Map') for (const [k, v] of node.entries) target.set(decode(k), decode(v));
    else if (node.type === 'Set') for (const v of node.entries) target.add(decode(v));
    else if (node.type === 'Array') for (const v of node.entries) target.push(decode(v));
    else for (const [key, value] of node.entries) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid snapshot property');
      Object.defineProperty(target, key, { value: decode(value), writable: true, enumerable: true, configurable: true });
    }
  });
  return decode(data.root);
}

export function encryptionKey(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw new Error('SNAPSHOT_KEY must contain 64 hex characters');
  return Buffer.from(secret, 'hex');
}

export function encrypt(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decrypt(value, key) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 28) throw new Error('Invalid encrypted snapshot');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
}
