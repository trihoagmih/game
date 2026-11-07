import { ITEM_KINDS, LEVEL_TICKS, MINE, TICK_MS, hookDir } from '@game/shared/goldmine';
import type { ItemKind, MineSnapshot } from '@game/shared/goldmine';

// Vẽ Đào vàng lên canvas: bầu trời chạng vạng, người đào bên tời, dây và móc theo góc của engine,
// lòng đất nhiều lớp với vàng, đá, kim cương, túi bí ẩn. Hình khối tự vẽ, không dùng ảnh ngoài.

export const MINE_SCALE = 2;

export interface MineScene {
  mine: MineSnapshot;
  /** Bước hiện tại của ván (để biết hiệu ứng "+tiền"/vụ nổ mới cách đây bao lâu). */
  tick: number;
  now: number;
  still: boolean;
  /** Màn chờ: chỉ vẽ cảnh, không vẽ thanh trạng thái. */
  title: boolean;
}

const money = (n: number) => `${n.toLocaleString('vi-VN')}$`;
const FX_TICKS = 50;

const SPECKS = Array.from({ length: 70 }, (_, i) => [(i * 131) % MINE.W, MINE.GROUND + 8 + ((i * 89) % (MINE.H - MINE.GROUND - 10)), 1 + (i % 3)] as const);
const STRATA = [150, 215, 290, 350];

/** Đa giác méo đều cho cục vàng/đá: hình dáng cố định theo id. */
function lump(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, id: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const k = 0.82 + (((id * 7 + i * 13) % 9) / 9) * 0.26;
    const px = x + Math.cos(a) * r * k;
    const py = y + Math.sin(a) * r * k * 0.9;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function item(ctx: CanvasRenderingContext2D, kind: ItemKind, x: number, y: number, r: number, id: number, dir: -1 | 0 | 1 = 1) {
  if (kind === 'goldS' || kind === 'goldM' || kind === 'goldL') {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, '#fef3c7');
    g.addColorStop(0.45, '#fbbf24');
    g.addColorStop(1, '#b45309');
    ctx.fillStyle = g;
    lump(ctx, x, y, r, id);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  if (kind === 'rockS' || kind === 'rockL') {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#d1d5db');
    g.addColorStop(1, '#4b5563');
    ctx.fillStyle = g;
    lump(ctx, x, y, r, id + 3);
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  if (kind === 'diamond') {
    ctx.fillStyle = '#a5f3fc';
    ctx.strokeStyle = '#0e7490';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - r - 2);
    ctx.lineTo(x + r + 1, y);
    ctx.lineTo(x, y + r + 2);
    ctx.lineTo(x - r - 1, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ecfeff';
    ctx.fillRect(x - 1.5, y - r + 1, 2.5, 4);
    return;
  }
  if (kind === 'tnt') {
    ctx.fillStyle = '#b91c1c';
    ctx.strokeStyle = '#450a0a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - r, y - r, r * 2, r * 2, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fee2e2';
    ctx.font = '800 9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', x, y + 1);
    return;
  }
  if (kind === 'mouse' || kind === 'mouseGem') {
    ctx.fillStyle = '#a8a29e';
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + dir * r * 0.9, y - r * 0.2, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f9a8d4';
    ctx.beginPath();
    ctx.arc(x + dir * r * 0.75, y - r * 0.75, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + dir * r * 1.05 - 1, y - r * 0.35, 2, 2);
    ctx.strokeStyle = '#78716c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - dir * r, y);
    ctx.quadraticCurveTo(x - dir * r * 1.8, y - r, x - dir * r * 2.2, y - r * 0.2);
    ctx.stroke();
    if (kind === 'mouseGem') item(ctx, 'diamond', x + dir * r * 1.5, y + r * 0.2, 6, 0);
    return;
  }
  ctx.fillStyle = '#a16207';
  ctx.strokeStyle = '#422006';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, r, r - 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#713f12';
  ctx.fillRect(x - 4, y - r + 1, 8, 4);
  ctx.fillStyle = '#fef3c7';
  ctx.font = '700 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', x, y + 3);
}

function miner(ctx: CanvasRenderingContext2D) {
  const x = MINE.PIVOT_X - 46;
  const ground = MINE.GROUND;
  ctx.fillStyle = '#334155';
  ctx.fillRect(x - 9, ground - 30, 18, 24);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(x - 8, ground - 7, 6, 7);
  ctx.fillRect(x + 2, ground - 7, 6, 7);
  ctx.fillStyle = '#fcd9b6';
  ctx.beginPath();
  ctx.arc(x, ground - 38, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(x, ground - 41, 9, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#fff7ae';
  ctx.fillRect(x + 6, ground - 46, 4, 4);
  // Râu, mắt, và dây quần bảo hộ.
  ctx.fillStyle = '#fff3d6';
  ctx.beginPath();
  ctx.ellipse(x + 2, ground - 33, 8, 6, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#292524';
  ctx.fillRect(x + 4, ground - 40, 2, 2);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(x - 6, ground - 29, 3, 16);
  ctx.fillRect(x + 3, ground - 29, 3, 16);
  ctx.fillStyle = '#92400e';
  ctx.fillRect(x - 10, ground - 4, 9, 4);
  ctx.fillRect(x + 1, ground - 4, 10, 4);
  ctx.strokeStyle = '#fcd9b6';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + 6, ground - 24);
  ctx.lineTo(MINE.PIVOT_X - 14, MINE.PIVOT_Y - 2);
  ctx.stroke();
}

function winch(ctx: CanvasRenderingContext2D, turn: number) {
  ctx.fillStyle = '#57534e';
  ctx.fillRect(MINE.PIVOT_X - 18, MINE.PIVOT_Y + 6, 36, MINE.GROUND - MINE.PIVOT_Y - 6);
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.arc(MINE.PIVOT_X, MINE.PIVOT_Y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const a = turn + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(MINE.PIVOT_X, MINE.PIVOT_Y);
    ctx.lineTo(MINE.PIVOT_X + Math.cos(a) * 11, MINE.PIVOT_Y + Math.sin(a) * 11);
    ctx.stroke();
  }
}

export function drawMine(cv: HTMLCanvasElement, sc: MineScene) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const { mine } = sc;
  ctx.setTransform(MINE_SCALE, 0, 0, MINE_SCALE, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, MINE.GROUND);
  sky.addColorStop(0, '#1e1b4b');
  sky.addColorStop(1, '#7c2d12');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, MINE.W, MINE.GROUND);
  const earth = ctx.createLinearGradient(0, MINE.GROUND, 0, MINE.H);
  earth.addColorStop(0, '#6b4423');
  earth.addColorStop(1, '#2a1a0e');
  ctx.fillStyle = earth;
  ctx.fillRect(0, MINE.GROUND, MINE.W, MINE.H - MINE.GROUND);
  ctx.fillStyle = '#3f6212';
  ctx.fillRect(0, MINE.GROUND, MINE.W, 5);
  ctx.strokeStyle = 'rgba(0,0,0,.18)';
  ctx.lineWidth = 2;
  for (const y of STRATA) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= MINE.W; x += 80) ctx.lineTo(x, y + ((x / 80) % 2 ? 6 : -4));
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  for (const [x, y, s] of SPECKS) ctx.fillRect(x, y, s, s);

  for (const o of mine.items) item(ctx, o.kind, o.x, o.y, o.r, o.id, o.dir);

  miner(ctx);
  winch(ctx, sc.still ? 0 : mine.hook.rope / 160);

  const { dx, dy } = hookDir(mine.hook.angle);
  const len = mine.hook.rope / 16;
  const tx = MINE.PIVOT_X + (len * dx) / 1024;
  const ty = MINE.PIVOT_Y + (len * dy) / 1024;
  ctx.strokeStyle = '#e7e5e4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MINE.PIVOT_X, MINE.PIVOT_Y);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(-Math.atan2(dx, dy));
  if (mine.hook.grab) item(ctx, mine.hook.grab, 0, ITEM_KINDS[mine.hook.grab].r + 6, ITEM_KINDS[mine.hook.grab].r, 1);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-9, 10);
  ctx.quadraticCurveTo(-11, 0, 0, 0);
  ctx.quadraticCurveTo(11, 0, 9, 10);
  ctx.stroke();
  ctx.restore();

  dynamiteSticks(ctx, mine.dynamite);
  if (mine.blast) {
    const age = sc.tick - mine.blast.at;
    if (age >= 0 && age < FX_TICKS) {
      const k = age / FX_TICKS;
      ctx.fillStyle = `rgba(253, 186, 116, ${0.7 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(mine.blast.x, mine.blast.y, sc.still ? 40 : 20 + k * 60, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (sc.title) return;
  // Canvas bị co nhỏ (điện thoại) thì phóng chữ lên để vẫn đọc được
  const k = Math.min(1.9, Math.max(1, 520 / (cv.clientWidth || MINE.W)));
  hud(ctx, mine, k);
  if (mine.cash) {
    const age = sc.tick - mine.cash.at;
    if (age >= 0 && age < FX_TICKS * 2) {
      ctx.globalAlpha = 1 - age / (FX_TICKS * 2);
      label(ctx, mine.cash.amount ? `+${money(mine.cash.amount)}` : 'Túi bất ngờ!', MINE.PIVOT_X + 60, MINE.PIVOT_Y - 4 - (sc.still ? 0 : age / 4), 18 * k, '#86efac', 'left');
      ctx.globalAlpha = 1;
    }
  }
  if (mine.phase === 'play' && mine.levelTick < 120) {
    ctx.fillStyle = 'rgba(15,23,42,.6)';
    ctx.fillRect(0, MINE.H / 2 - 44 * k, MINE.W, 88 * k);
    label(ctx, `Màn ${mine.level}`, MINE.W / 2, MINE.H / 2 - 6 * k, 30 * k, '#fde68a', 'center');
    label(ctx, `Mục tiêu: ${money(mine.goal)}`, MINE.W / 2, MINE.H / 2 + 26 * k, 18 * k, '#fff', 'center');
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign) {
  ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 5);
  ctx.strokeStyle = 'rgba(15,23,42,.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Thanh trạng thái trên bầu trời như bản cổ điển: tiền/mục tiêu bên trái, thời gian/màn bên phải. */
function hud(ctx: CanvasRenderingContext2D, mine: MineSnapshot, k: number) {
  const seconds = Math.ceil(((LEVEL_TICKS - mine.levelTick) * TICK_MS) / 1000);
  const big = 17 * k;
  const small = 15 * k;
  label(ctx, `Tiền: ${money(mine.money)}`, 12, 8 + big, big, mine.money >= mine.goal ? '#86efac' : '#fde68a', 'left');
  label(ctx, `Mục tiêu: ${money(mine.goal)}`, 12, 14 + big + small, small, '#fed7aa', 'left');
  label(ctx, `${mine.phase === 'play' ? seconds : 0} giây`, MINE.W - 12, 8 + big, big, seconds <= 10 ? '#fca5a5' : '#fde68a', 'right');
  label(ctx, `Màn ${mine.level}`, MINE.W - 12, 14 + big + small, small, '#fed7aa', 'right');
}

/** Số thuốc nổ: các thỏi đỏ cạnh người đào. */
function dynamiteSticks(ctx: CanvasRenderingContext2D, count: number) {
  for (let i = 0; i < Math.min(count, 6); i++) {
    const x = MINE.PIVOT_X + 30 + i * 9;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(x, MINE.GROUND - 20, 6, 18);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(x + 2, MINE.GROUND - 24, 2, 4);
  }
}
