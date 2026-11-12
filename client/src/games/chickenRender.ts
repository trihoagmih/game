import { CHICKEN } from '@game/shared/chicken';
import type { ChickenField } from '@game/shared/chicken';

export function drawChicken(canvas: HTMLCanvasElement, field: ChickenField, score: number, tick: number, title: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#080e20';
  ctx.fillRect(0, 0, CHICKEN.W, CHICKEN.H);
  for (let i = 0; i < 95; i++) {
    ctx.fillStyle = i % 3 ? '#536384' : '#b0d5ec';
    ctx.fillRect((i * 137 + 29) % 480, (i * 83 + Math.floor(tick / 3)) % 640, i % 3 ? 1 : 2, 2);
  }
  ctx.textAlign = 'left';
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#fbbf24';
  ctx.fillText(String(score).padStart(6, '0'), 22, 32);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#dbeafe';
  ctx.fillText(`ĐỢT ${field.wave}   ${field.lives} MẠNG`, 458, 32);
  for (const e of field.enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = e.hp > 1 ? '#fbbf24' : '#f4f3e8';
    ctx.beginPath(); ctx.ellipse(0, 0, 17, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-19, 1, 10, 5, -0.5, 0, Math.PI * 2); ctx.ellipse(19, 1, 10, 5, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f87171';
    ctx.fillRect(-7, -21, 6, 10); ctx.fillRect(1, -24, 6, 12);
    ctx.fillStyle = '#fb923c';
    ctx.beginPath(); ctx.moveTo(-5, 4); ctx.lineTo(6, 4); ctx.lineTo(0, 12); ctx.fill();
    ctx.fillStyle = '#111827'; ctx.fillRect(-7, -4, 4, 5); ctx.fillRect(5, -4, 4, 5);
    ctx.restore();
  }
  ctx.fillStyle = '#67e8f9';
  for (const b of field.bullets) ctx.fillRect(b.x - 2, b.y - 10, 4, 18);
  ctx.fillStyle = '#fff1c2';
  for (const e of field.eggs) { ctx.beginPath(); ctx.ellipse(e.x, e.y, 6, 9, 0, 0, Math.PI * 2); ctx.fill(); }
  if (!field.shield || tick % 8 < 4) {
    ctx.save(); ctx.translate(field.x, CHICKEN.SHIP_Y);
    ctx.fillStyle = '#34d399';
    ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(24, 18); ctx.lineTo(0, 9); ctx.lineTo(-24, 18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d1fae5'; ctx.fillRect(-4, -8, 8, 19);
    ctx.fillStyle = '#fbbf24'; ctx.fillRect(-5, 15, 10, 10 + tick % 7);
    ctx.restore();
  }
  if (title) {
    ctx.fillStyle = '#080e20dd'; ctx.fillRect(0, 260, 480, 140);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 44px monospace'; ctx.fillText('BẮN GÀ', 240, 315);
    ctx.fillStyle = '#dbeafe'; ctx.font = '17px sans-serif'; ctx.fillText('Phi thuyền nhỏ. Cuộc chiến lớn.', 240, 355);
  }
}
