import { MAX_FALL, SKY, SUB, pillarX } from '@game/shared/skyhop';

// Vẽ Bay qua khe lên canvas: trời đêm, đồi xa cuộn chậm (tắt khi giảm chuyển động), cột đá, dải cỏ,
// chim của mình và "bóng" của người khác ở đúng khoảng cách họ đang đi trước/sau. Màn tiêu đề (chờ
// ván), "Chuẩn bị!" (chưa chạm lần nào) và lóe trắng khi va là phần trình bày, không ảnh hưởng luật.

export const SKY_SCALE = 2;

export interface SkyGhost { id: string; name: string; tick: number; y: number; done: boolean }

export type SkyMode = 'title' | 'ready' | 'fly' | 'dead';

export interface SkyScene {
  mode: SkyMode;
  tick: number;
  /** ms kể từ lúc va (lóe trắng); âm hoặc rất lớn thì không vẽ. */
  sinceHit: number;
  /** Thời gian thực (ms) để chim nhấp nhô ở màn tiêu đề / Chuẩn bị. */
  now: number;
  /** 0..1, phần đã trôi giữa hai bước để chuyển động mượt. */
  alpha: number;
  y: number;
  vy: number;
  score: number;
  target: number;
  speed: number;
  gap: number;
  gapAt: (k: number) => number;
  gapCenter: (k: number) => number;
  dead: boolean;
  ghosts: SkyGhost[];
  still: boolean;
}

function banner(ctx: CanvasRenderingContext2D, text: string, y: number, size: number, fill: string) {
  ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, size / 6);
  ctx.strokeStyle = 'rgba(15,23,42,.85)';
  ctx.strokeText(text, SKY.W / 2, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, SKY.W / 2, y);
}

/** Gợi ý chạm: vòng tròn nhấp nháy dưới chim. */
function tapHint(ctx: CanvasRenderingContext2D, x: number, y: number, now: number, still: boolean) {
  const pulse = still ? 0.5 : (now % 1000) / 1000;
  ctx.strokeStyle = `rgba(253, 230, 138, ${0.9 - pulse * 0.7})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 14 + pulse * 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
}

const HILLS_FAR = [0, 380, 40, 350, 90, 372, 150, 330, 210, 360, 260, 340, 288, 380];
const HILLS_NEAR = [0, 410, 50, 392, 110, 414, 170, 386, 230, 404, 288, 410];
const STARS = Array.from({ length: 28 }, (_, i) => [(i * 97) % SKY.W, (i * 53) % 260, 1 + (i % 3) * 0.5] as const);

function hills(ctx: CanvasRenderingContext2D, points: readonly number[], offset: number, color: string) {
  ctx.fillStyle = color;
  for (const shift of [-offset, SKY.W - offset]) {
    ctx.beginPath();
    ctx.moveTo(shift, SKY.GROUND);
    for (let i = 0; i < points.length; i += 2) ctx.lineTo(shift + points[i], points[i + 1]);
    ctx.lineTo(shift + SKY.W, SKY.GROUND);
    ctx.closePath();
    ctx.fill();
  }
}

function pillar(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number) {
  const w = SKY.PILLAR_W;
  ctx.fillStyle = '#7c5a3c';
  ctx.fillRect(x, top, w, bottom - top);
  ctx.fillStyle = '#9a7550';
  ctx.fillRect(x + 6, top, 10, bottom - top);
  ctx.fillStyle = '#5b3f29';
  ctx.fillRect(x + w - 8, top, 8, bottom - top);
}

function cap(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#b08b5e';
  ctx.fillRect(x - 4, y, SKY.PILLAR_W + 8, 14);
  ctx.fillStyle = '#5b3f29';
  ctx.fillRect(x - 4, y + 11, SKY.PILLAR_W + 8, 3);
}

function bird(ctx: CanvasRenderingContext2D, x: number, y: number, vy: number, dead: boolean) {
  const tilt = Math.max(-0.45, Math.min(1.1, (vy / MAX_FALL) * 1.1));
  const r = SKY.BIRD_R;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.fillStyle = dead ? '#94a3b8' : '#f59e0b';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dead ? '#cbd5e1' : '#fde68a';
  ctx.beginPath();
  ctx.ellipse(1, 4, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dead ? '#64748b' : '#b45309';
  ctx.beginPath();
  ctx.ellipse(-4, vy < 0 ? -3 : 2, 7, 4, vy < 0 ? -0.6 : 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(5, -4, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(6, -4, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ea580c';
  ctx.beginPath();
  ctx.moveTo(r - 2, -1);
  ctx.lineTo(r + 7, 2);
  ctx.lineTo(r - 2, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawSky(cv: HTMLCanvasElement, sc: SkyScene) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(SKY_SCALE, 0, 0, SKY_SCALE, 0, 0);
  const scroll = ((sc.tick + sc.alpha) * sc.speed) / SUB;

  const sky = ctx.createLinearGradient(0, 0, 0, SKY.GROUND);
  sky.addColorStop(0, '#0b1730');
  sky.addColorStop(1, '#1d4a5c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, SKY.W, SKY.GROUND);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (const [x, y, s] of STARS) ctx.fillRect(x, y, s, s);
  const far = sc.still ? 0 : (scroll * 0.15) % SKY.W;
  const near = sc.still ? 0 : (scroll * 0.4) % SKY.W;
  hills(ctx, HILLS_FAR, far, '#17384a');
  hills(ctx, HILLS_NEAR, near, '#1c4a3f');

  const first = Math.max(0, Math.floor((scroll - SKY.FIRST_X - SKY.PILLAR_W) / SKY.SPACING));
  for (let k = first; k < first + 4; k++) {
    const x = pillarX(k) - scroll;
    if (x > SKY.W) break;
    const c = sc.gapCenter(k);
    const half = sc.gapAt(k) >> 1;
    pillar(ctx, x, 0, c - half);
    cap(ctx, x, c - half - 14);
    pillar(ctx, x, c + half, SKY.GROUND);
    cap(ctx, x, c + half);
  }

  ctx.fillStyle = '#2f5d34';
  ctx.fillRect(0, SKY.GROUND, SKY.W, 12);
  ctx.fillStyle = '#3e7a43';
  const stripe = sc.still ? 0 : scroll % 24;
  for (let x = -stripe; x < SKY.W; x += 24) ctx.fillRect(x, SKY.GROUND, 12, 12);
  ctx.fillStyle = '#3b2a1d';
  ctx.fillRect(0, SKY.GROUND + 12, SKY.W, SKY.H - SKY.GROUND - 12);

  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const g of sc.ghosts) {
    const x = SKY.BIRD_X + ((g.tick - sc.tick) * sc.speed) / SUB;
    if (x < -20 || x > SKY.W + 20) continue;
    const y = g.y / SUB;
    ctx.globalAlpha = g.done ? 0.25 : 0.45;
    ctx.fillStyle = '#93c5fd';
    ctx.beginPath();
    ctx.arc(x, y, SKY.BIRD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(g.name.slice(0, 10), x, y - SKY.BIRD_R - 5);
    ctx.globalAlpha = 1;
  }

  // Nhấp nhô khi đang chờ chỉ là trình bày; vị trí thật của chim vẫn do engine giữ
  const hover = sc.mode === 'title' || sc.mode === 'ready' ? (sc.still ? 0 : Math.sin(sc.now / 180) * 5) : 0;
  const birdX = sc.mode === 'title' ? SKY.W / 2 : SKY.BIRD_X;
  bird(ctx, birdX, (sc.y + sc.vy * sc.alpha) / SUB + hover, sc.mode === 'fly' || sc.mode === 'dead' ? sc.vy : 0, sc.dead);

  if (sc.mode === 'title') {
    banner(ctx, 'BAY QUA KHE', 150, 34, '#fde68a');
    return;
  }
  banner(ctx, sc.target ? `${sc.score}/${sc.target}` : String(sc.score), 64, 40, '#fff');
  if (sc.mode === 'ready') {
    banner(ctx, 'Chuẩn bị!', 150, 30, '#86efac');
    tapHint(ctx, SKY.BIRD_X, (sc.y / SUB) + 70, sc.now, sc.still);
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('Chạm để bay', SKY.BIRD_X, sc.y / SUB + 104);
  }
  if (sc.sinceHit >= 0 && sc.sinceHit < 220 && !sc.still) {
    ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - sc.sinceHit / 220)})`;
    ctx.fillRect(0, 0, SKY.W, SKY.H);
  }
}
