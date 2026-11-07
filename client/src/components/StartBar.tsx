// Thanh bắt đầu ván dùng chung cho mọi trò: không tự bắt đầu —
// người ngồi bàn bấm "Sẵn sàng", khi mọi người đã sẵn sàng thì chủ phòng bấm "Bắt đầu".
import { Check, Play, Crown } from 'lucide-react';
import { useRoomApp } from '../store.js';
import type { ReactNode } from 'react';
import type { Identity } from '@game/shared/contracts';
import './StartBar.css';

/**
 * players: [{ id, name }] người đang ngồi bàn
 * ready: id đã sẵn sàng; waitingFor: id còn phải chờ (server tính, không gồm chủ phòng)
 * seated: mình có đang ngồi bàn không
 */
export default function StartBar({ players, ready = [], waitingFor = [], seated, min = 2, startLabel = 'Bắt đầu', readyLabel = 'Sẵn sàng', onStart }: {
  players: Identity[]; ready?: string[]; waitingFor?: string[]; seated: boolean; min?: number;
  startLabel?: ReactNode; readyLabel?: ReactNode; onStart?: () => void;
}) {
  const { act, room, user } = useRoomApp();
  const isOwner = room.ownerId === user.id;
  const n = players.length;
  const waitNames = players.filter((p) => waitingFor.includes(p.id)).map((p) => (p.id === user.id ? 'bạn' : p.name));
  const canStart = isOwner && n >= min && waitNames.length === 0;
  const iAmReady = ready.includes(user.id);
  const ownerName = room.members.find((m) => m.id === room.ownerId)?.name || 'chủ phòng';

  let status;
  if (n < min) status = `Cần ít nhất ${min} người ngồi bàn`;
  else if (waitNames.length) status = `Chờ ${waitNames.join(', ')} sẵn sàng`;
  else if (isOwner) status = 'Mọi người đã sẵn sàng — bấm Bắt đầu';
  else status = `Chờ ${ownerName} (chủ phòng) bấm Bắt đầu`;

  return (
    <>
      {seated && !isOwner && (
        <button className={`btn ${iAmReady ? '' : 'cta'}`} onClick={() => act({ type: 'ready' })} aria-pressed={iAmReady}>
          {iAmReady ? 'Hủy sẵn sàng' : <><Check size={16} aria-hidden /> {readyLabel}</>}
        </button>
      )}
      {isOwner && (
        <button className="btn cta" disabled={!canStart} onClick={() => (onStart ? onStart() : act({ type: 'start' }))}
          title={canStart ? undefined : status}>
          <Play size={16} aria-hidden /> {startLabel}
        </button>
      )}
      <span className="muted small ba-note start-status" role="status">
        {isOwner && <Crown size={13} className="owner-crown" aria-label="Bạn là chủ phòng" />} {status}
      </span>
    </>
  );
}

/** Dấu "✔ sẵn sàng" / "chủ phòng" cạnh tên người chơi trước ván. */
export function ReadyMark({ id, ready, ownerId }: { id: string; ready: string[]; ownerId: string }) {
  if (id === ownerId) return <span className="ready owner" title="Chủ phòng — bấm Bắt đầu khi mọi người sẵn sàng"> 👑</span>;
  return ready.includes(id) ? <span className="ready" title="Đã sẵn sàng"> ✔</span> : null;
}
