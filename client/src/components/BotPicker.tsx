// Chọn mức độ để thêm máy (bot) vào bàn — dùng cho Cờ caro và Nối từ.
import { Bot } from 'lucide-react';
import type { Identity } from '@game/shared/contracts';
import './BotPicker.css';

export const BOT_LEVELS = [
  ['easy', 'Dễ'],
  ['medium', 'Vừa'],
  ['hard', 'Khó'],
];

export default function BotPicker({ onPick, label = 'Chơi với máy' }: { onPick: (level: string) => void; label?: string }) {
  return (
    <label className="bot-pick btn sm" title="Thêm người chơi máy vào bàn">
      <Bot size={14} aria-hidden />
      <span>{label}</span>
      <select value="" aria-label={label} onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="" disabled>Chọn mức độ…</option>
        {BOT_LEVELS.map(([v, name]) => <option key={v} value={v}>Máy {name}</option>)}
      </select>
    </label>
  );
}

/** Người đang ngồi chơi hoặc chủ phòng mới được thêm / bỏ máy (server cũng kiểm tra). */
export const canManageBots = (room: { ownerId: string }, user: Identity | null, seated: boolean) => seated || room.ownerId === user?.id;
