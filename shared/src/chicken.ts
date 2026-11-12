import { rng } from './onet.js';
import type { RaceEngine, RacePlayerView, RaceView } from './race.js';

export const CHICKEN = { W: 480, H: 640, SHIP_Y: 584, TICK_MS: 20, MAX_TICKS: 15000 } as const;
export type ChickenCommand = 'left' | 'right' | 'stop';
export const CHICKEN_COMMANDS: readonly ChickenCommand[] = ['left', 'right', 'stop'];
export interface ChickenBody { x: number; y: number }
export interface ChickenEnemy extends ChickenBody { hp: number }
export interface ChickenField {
  x: number; lives: number; wave: number; shield: number;
  enemies: ChickenEnemy[]; bullets: ChickenBody[]; eggs: ChickenBody[];
}
export interface ChickenPlayerView extends RacePlayerView { field: ChickenField }
export type ChickenView = RaceView<{ level: number }, ChickenPlayerView>;

/** Integer-only simulation, replayed by the server from direction changes. */
export class ChickenGame implements RaceEngine<ChickenCommand> {
  tick = 0;
  score = 0;
  x = CHICKEN.W / 2;
  lives = 3;
  wave = 0;
  shield = 0;
  direction = 0;
  formation = 1;
  enemies: ChickenEnemy[] = [];
  bullets: ChickenBody[] = [];
  eggs: ChickenBody[] = [];
  readonly rand: ReturnType<typeof rng>;
  readonly level: number;

  constructor({ seed, level }: { seed: number; level: number }) {
    this.rand = rng(seed);
    this.level = Math.min(3, Math.max(1, Math.floor(level) || 1));
    this.nextWave();
  }

  get over() { return this.lives <= 0 || this.tick >= CHICKEN.MAX_TICKS; }

  command(command: ChickenCommand) {
    if (this.over || !CHICKEN_COMMANDS.includes(command)) return false;
    const direction = command === 'left' ? -1 : command === 'right' ? 1 : 0;
    if (this.direction === direction) return false;
    this.direction = direction;
    return true;
  }

  nextWave() {
    this.wave++;
    this.formation = 1;
    this.bullets = [];
    this.eggs = [];
    for (let row = 0; row < Math.min(5, 2 + this.wave); row++) {
      for (let col = 0; col < 7; col++) {
        this.enemies.push({ x: 60 + col * 56, y: 80 + row * 48, hp: this.wave % 4 === 0 ? 2 : 1 });
      }
    }
    this.shield = Math.max(this.shield, 50);
  }

  step() {
    if (this.over) return;
    this.tick++;
    this.shield = Math.max(0, this.shield - 1);
    this.x = Math.min(CHICKEN.W - 22, Math.max(22, this.x + this.direction * 6));
    if (this.tick % 10 === 0) this.bullets.push({ x: this.x, y: CHICKEN.SHIP_Y - 24 });
    if (this.tick % Math.max(5, 19 - this.level * 2 - this.wave) === 0 && this.enemies.length) {
      const enemy = this.enemies[Math.floor(this.rand() * this.enemies.length)];
      this.eggs.push({ x: enemy.x, y: enemy.y + 18 });
    }
    const speed = 1 + Math.floor((this.wave - 1) / 4);
    if (this.enemies.some((e) => e.x + this.formation * speed < 24 || e.x + this.formation * speed > CHICKEN.W - 24)) {
      this.formation *= -1;
      for (const e of this.enemies) e.y += 12;
    }
    for (const e of this.enemies) e.x += this.formation * speed;
    for (const b of this.bullets) {
      b.y -= 12;
      const enemy = this.enemies.find((e) => e.hp > 0 && Math.abs(e.x - b.x) < 23 && Math.abs(e.y - b.y) < 20);
      if (enemy) {
        b.y = -100;
        enemy.hp--;
        if (!enemy.hp) this.score += 10 * this.wave;
      }
    }
    for (const egg of this.eggs) egg.y += 3 + this.level + Math.min(5, Math.floor(this.wave / 2));
    const hit = this.eggs.find((e) => Math.abs(e.x - this.x) < 20 && Math.abs(e.y - CHICKEN.SHIP_Y) < 22);
    if (hit && !this.shield) {
      this.lives--;
      this.shield = 100;
      hit.y = CHICKEN.H + 100;
    }
    this.bullets = this.bullets.filter((b) => b.y > -20);
    this.eggs = this.eggs.filter((e) => e.y < CHICKEN.H + 20);
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    if (this.enemies.some((e) => e.y >= CHICKEN.SHIP_Y - 30)) this.lives = 0;
    if (!this.enemies.length && !this.over) this.nextWave();
  }

  view(): ChickenField {
    return { x: this.x, lives: this.lives, wave: this.wave, shield: this.shield,
      enemies: this.enemies.map((e) => ({ ...e })), bullets: this.bullets.map((b) => ({ ...b })), eggs: this.eggs.map((e) => ({ ...e })) };
  }
}
