import assert from 'node:assert/strict';
import test from 'node:test';
import { CHICKEN, ChickenGame } from '../src/chicken.js';
import { replayRace } from '../src/race.js';

test('direction log replays the same enemies, eggs, score and random progress', () => {
  const a = new ChickenGame({ seed: 42, level: 2 });
  const b = new ChickenGame({ seed: 42, level: 2 });
  const inputs: [number, 'left' | 'right' | 'stop'][] = [[0, 'left'], [50, 'right'], [110, 'stop']];
  replayRace(a, inputs, 900);
  replayRace(b, inputs, 300);
  replayRace(b, inputs, 900, inputs.length);
  assert.deepEqual(b.view(), a.view());
  assert.equal(b.score, a.score);
  assert.equal(b.rand(), a.rand());
});

test('ship stays on screen; duplicate and invalid commands do not change movement', () => {
  const g = new ChickenGame({ seed: 3, level: 1 });
  assert.equal(g.command('left'), true);
  assert.equal(g.command('left'), false);
  for (let i = 0; i < 100; i++) g.step();
  assert.equal(g.x, 22);
  g.command('right');
  for (let i = 0; i < 100; i++) g.step();
  assert.equal(g.x, CHICKEN.W - 22);
});

test('bullets destroy chickens, score and advance waves; golden chickens need two hits', () => {
  const g = new ChickenGame({ seed: 1, level: 1 });
  g.wave = 4;
  g.enemies = [{ x: 240, y: 100, hp: 2 }];
  g.bullets = [{ x: 240, y: 112 }];
  g.step();
  assert.equal(g.enemies[0].hp, 1);
  assert.equal(g.score, 0);
  g.bullets.push({ x: 240, y: 112 });
  g.step();
  assert.equal(g.wave, 5);
  assert.equal(g.score, 40);
  assert.equal(g.enemies.length, 35);
});

test('egg hits cost one life with invulnerability; end state cannot be mutated', () => {
  const g = new ChickenGame({ seed: 1, level: 1 });
  g.shield = 0;
  g.eggs = [{ x: g.x, y: CHICKEN.SHIP_Y - 4 }, { x: g.x, y: CHICKEN.SHIP_Y - 4 }];
  g.step();
  assert.equal(g.lives, 2);
  g.step();
  assert.equal(g.lives, 2);
  g.lives = 0;
  const tick = g.tick;
  assert.equal(g.command('left'), false);
  g.step();
  assert.equal(g.tick, tick);
});

test('invasion and five-minute limit terminate a run; view has no mutable aliases', () => {
  const g = new ChickenGame({ seed: 1, level: 1 });
  g.view().enemies[0].hp = 0;
  assert.equal(g.enemies[0].hp, 1);
  g.enemies[0].y = CHICKEN.SHIP_Y;
  g.step();
  assert.equal(g.over, true);
  const timed = new ChickenGame({ seed: 1, level: 1 });
  timed.tick = CHICKEN.MAX_TICKS - 1;
  timed.step();
  assert.equal(timed.over, true);
});
