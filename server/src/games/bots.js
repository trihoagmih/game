// Tiện ích chung cho người chơi máy (bot). Bot không phải người dùng thật: không có socket, không là
// thành viên phòng; id bắt đầu bằng "bot:" (id người dùng thật không bao giờ chứa dấu ":").
import { randomUUID } from 'node:crypto';
export const BOT_LEVELS = ['easy', 'medium', 'hard'];
export const BOT_LEVEL_NAMES = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' };

export const isBot = (id) => typeof id === 'string' && id.startsWith('bot:');
export const botLevel = (v, def = null) => (BOT_LEVELS.includes(v) ? v : def);

/** Thời gian "suy nghĩ" ngẫu nhiên trong [min, max] ms cho tự nhiên. */
export const thinkMs = (min, max) => Math.round(min + Math.random() * (max - min));

/** Chỉ người đang ngồi chơi hoặc chủ phòng mới được thêm / bỏ máy. */
export function requireBotManager(handler, id) {
  if (!handler.playerIds().includes(id) && handler.room.ownerId !== id) {
    throw new Error('Chỉ người đang ngồi chơi hoặc chủ phòng mới được thêm / bỏ máy');
  }
}

/** Id duy nhất cho một máy (dùng khi một bàn có nhiều máy). */
export const newBotId = () => `bot:${randomUUID()}`;
