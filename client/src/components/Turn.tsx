import { useEffect, useRef } from 'react';
import { Hand, Hourglass } from 'lucide-react';
import type { Identity, RoomState } from '@game/shared/contracts';
import './Turn.css';

export interface TurnInfo { mine: boolean; who?: string; text?: string }

const nameAt = (seats: Partial<Record<string | number, Identity | null>>, key: string | number) => seats[key]?.name;

/** Ai đang tới lượt, cho từng trò. Trả về null khi chưa có ván đang chơi. */
export function turnInfo(room: RoomState, userId: string): TurnInfo | null {
  if (!room.state) return null;
  switch (room.game) {
    case 'chess':
    case 'xiangqi':
    case 'caro': {
      const s = room.state;
      if (s.status !== 'playing') return null;
      return { mine: !!s.myColor && s.myColor === s.turn, who: nameAt(s.seats, s.turn) };
    }
    case 'poker': {
      const s = room.state;
      const h = s.hand;
      if (!h || h.street === 'done' || h.toAct < 0) return null;
      return { mine: !!s.options, who: s.seats[h.toAct]?.name };
    }
    case 'tala': {
      const g = room.state.game;
      if (!g || g.result || g.turn < 0) return null;
      return { mine: g.turn === g.me, who: g.players[g.turn]?.name };
    }
    case 'samloc': {
      const g = room.state.game;
      if (!g || g.result) return null;
      if (g.phase === 'sam') {
        const need = g.me >= 0 && !g.samDecided.includes(g.me);
        return need ? { mine: true, text: 'Báo Sâm hay không?' } : { mine: false, text: 'Đang chờ mọi người quyết định báo Sâm' };
      }
      return g.turn >= 0 ? { mine: g.turn === g.me, who: g.players[g.turn]?.name } : null;
    }
    case 'scribble': {
      const s = room.state;
      if (s.status !== 'playing' || !s.drawerId) return null;
      const name = s.seats.find((x) => x.id === s.drawerId)?.name || '?';
      const mine = s.drawerId === userId;
      if (s.phase === 'choose') return mine ? { mine, text: 'Chọn từ để vẽ!' } : { mine, text: `${name} đang chọn từ` };
      if (s.phase === 'draw') return mine ? { mine, text: 'Đến lượt bạn vẽ!' } : { mine, text: `${name} đang vẽ — đoán đi!` };
      return null;
    }
    case 'telephone': {
      const s = room.state;
      if (s.status === 'reveal') return { mine: false, text: 'Đang xem lại các câu chuyện' };
      if (s.status !== 'playing') return null;
      if (s.task && !s.task.done) return { mine: true, text: s.kind === 'draw' ? 'Vẽ đi!' : s.step === 0 ? 'Viết một câu!' : 'Đoán tranh!' };
      return { mine: false, text: `Chờ mọi người (${s.players.filter((p) => p.done).length}/${s.players.filter((p) => !p.gone).length})` };
    }
    case 'twister': {
      const s = room.state;
      const cur = s.current;
      if (s.status !== 'playing' || !cur) return null;
      const who = s.players.find((p) => p.id === cur.readerId)?.name;
      if (cur.readerId === userId) return cur.phase === 'read' ? { mine: true, text: 'Đọc to câu líu lưỡi!' } : { mine: false, text: 'Chờ mọi người chấm' };
      if (cur.phase === 'read') return { mine: false, text: `${who ?? '?'} đang đọc — nghe và chấm` };
      if (cur.phase === 'judge' && cur.canVote && !cur.myVote) return { mine: true, text: 'Chấm ngay: Chuẩn hay Vấp?' };
      return null;
    }
    case 'snake': {
      const s = room.state;
      if (s.status !== 'playing') return null;
      const p = s.players.find((x) => x.id === userId);
      if (p && !p.done) return { mine: true, text: `Rắn dài ${p.length} · ${p.score} điểm` };
      return { mine: false, text: `Đang bò (${s.players.filter((x) => !x.done).length}/${s.players.length} còn sống)` };
    }
    case 'skyhop': {
      const s = room.state;
      if (s.status !== 'playing') return null;
      const p = s.players.find((x) => x.id === userId);
      if (p && !p.done) return { mine: true, text: `Đang bay · ${p.score} khe` };
      return { mine: false, text: `Đang bay (${s.players.filter((x) => !x.done).length}/${s.players.length} còn bay)` };
    }
    case 'goldmine': {
      const s = room.state;
      if (s.status !== 'playing') return null;
      const p = s.players.find((x) => x.id === userId);
      if (p && !p.done) return { mine: true, text: `Màn ${p.mine.level} · ${p.score.toLocaleString('vi-VN')}$` };
      return { mine: false, text: `Đang đào (${s.players.filter((x) => !x.done).length}/${s.players.length} còn đào)` };
    }
    case 'onet': {
      const s = room.state;
      if (s.status !== 'playing') return null;
      const p = s.players.find((x) => x.id === userId);
      if (p && !p.done) return { mine: true, text: s.options.mode === 'classic' ? `Màn ${p.level}/${s.levels} · còn ${p.left} ô` : `Nối nhanh! Còn ${p.left} ô` };
      return { mine: false, text: `Đang đua (${s.players.filter((x) => x.done).length}/${s.players.length} xong)` };
    }
    case 'wordchain': {
      const s = room.state;
      const g = s.game;
      if (s.status !== 'playing' || !g) return null;
      return { mine: g.currentId === userId, who: g.players.find((p) => p.id === g.currentId)?.name };
    }
    case 'quiz': {
      const s = room.state;
      const g = s.game;
      if (s.status !== 'playing' || !g || g.phase !== 'question' || !g.me) return null;
      return g.myChoice === null ? { mine: true, text: 'Trả lời nhanh!' } : { mine: false, text: `Chờ mọi người (${g.answered}/${g.players})` };
    }
    default:
      return null;
  }
}

/** Hiệu ứng khi tới lượt mình: đổi tiêu đề tab + rung nhẹ trên điện thoại (một lần mỗi lượt). */
export function TurnEffects({ info }: { info: TurnInfo | null }) {
  const mine = !!info?.mine;
  const prev = useRef(false);
  useEffect(() => {
    const base = 'Sảnh Trò Chơi';
    document.title = mine ? `● Đến lượt bạn — ${base}` : base;
    if (mine && !prev.current) {
      try { navigator.vibrate?.(60); } catch { /* không hỗ trợ */ }
    }
    prev.current = mine;
    return () => { document.title = base; };
  }, [mine]);
  return null;
}

/**
 * Báo lượt gọn trong đầu phòng (thay cho thanh riêng chiếm một hàng):
 * nằm ngay dưới tên phòng, cùng chỗ với dòng "Tên trò · #mã" khi chưa có ván.
 * Tới lượt mình: viên thuốc vàng nổi bật + khung bàn chơi phát sáng (CSS .game-area.my-turn).
 */
export function TurnPill({ info, sub }: { info: TurnInfo | null; sub: string }) {
  if (!info) return <span className="muted small room-sub">{sub}</span>;
  const mine = !!info.mine;
  return (
    <span className={`turn-pill ${mine ? 'mine' : 'other'}`} role="status" aria-live="polite">
      {mine ? <Hand size={14} aria-hidden /> : info.who ? <span className="tb-dot" aria-hidden /> : <Hourglass size={13} aria-hidden />}
      <span className="turn-pill-text">
        {mine ? <b>{info.text || 'Đến lượt bạn!'}</b> : info.who ? <>Lượt của <b>{info.who}</b></> : info.text}
      </span>
    </span>
  );
}
