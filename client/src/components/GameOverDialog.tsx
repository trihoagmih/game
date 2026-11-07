import { useEffect, useRef, useState } from 'react';
import { PartyPopper, Eye } from 'lucide-react';
import Modal from './Modal.js';
import StartBar from './StartBar.js';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Identity } from '@game/shared/contracts';
import './GameOverDialog.css';

/**
 * Popup "Hết ván!" dùng chung: tự mở khi ván vừa kết thúc, gom các nút Chơi ván mới / Sẵn sàng,
 * Đứng dậy / Vào chơi và nút đóng để xem lại bàn. Đóng rồi thì còn một dải nhỏ để mở lại.
 *
 * over: ván đã kết thúc · title/detail/children: tóm tắt kết quả của từng trò
 * seats/ready/waitingFor/seated/min: như StartBar · seatBtn: nút Đứng dậy / Vào chơi (tùy trò)
 */
export default function GameOverDialog({
  over, title = 'Hết ván!', detail, children, icon,
  seats, ready, waitingFor, seated, min = 2, startLabel = 'Chơi ván mới',
  seatBtn, reviewLabel = 'Xem lại bàn chơi', ReviewIcon = Eye,
}: {
  over: boolean; title?: ReactNode; detail?: ReactNode; children?: ReactNode; icon?: ReactNode;
  seats: Identity[]; ready?: string[]; waitingFor?: string[]; seated: boolean; min?: number; startLabel?: string;
  seatBtn?: ReactNode; reviewLabel?: string; ReviewIcon?: LucideIcon;
}) {
  const [open, setOpen] = useState(over);
  const wasOver = useRef(over);
  useEffect(() => {
    if (over && !wasOver.current) setOpen(true);
    wasOver.current = over;
  }, [over]);
  if (!over) return null;
  if (!open) {
    return (
      <button className="board-strip result go-strip" onClick={() => setOpen(true)}>
        <PartyPopper size={16} aria-hidden /><span>Ván đã kết thúc — <b>chơi ván mới?</b></span>
      </button>
    );
  }
  return (
    <Modal onClose={() => setOpen(false)}>
      <div className="go" role="status">
        <span className="bo-icon gold" aria-hidden>{icon || <PartyPopper size={26} />}</span>
        <div className="bo-title">{title}</div>
        {detail && <div className="bo-detail">{detail}</div>}
        {children}
        <div className="go-start">
          <StartBar players={seats} ready={ready} waitingFor={waitingFor} seated={seated} min={min}
            startLabel={startLabel} readyLabel={startLabel} />
        </div>
        <div className="bo-actions">
          <button className="btn" autoFocus onClick={() => setOpen(false)}><ReviewIcon size={16} aria-hidden /> {reviewLabel}</button>
          {seatBtn}
        </div>
      </div>
    </Modal>
  );
}

/** Bảng xếp hạng gọn trong popup: [{ id, name, value, note }] */
export interface GoRankRow { id: string; name: string; value?: ReactNode; note?: ReactNode }

export function GoRanking({ rows, me }: { rows: GoRankRow[] | null | undefined; me?: string | null }) {
  if (!rows?.length) return null;
  return (
    <ol className="go-rank">
      {rows.map((r, i) => (
        <li key={r.id} className={r.id === me ? 'me' : ''}>
          <span className="go-pos">{['🥇', '🥈', '🥉'][i] || i + 1}</span>
          <span className="go-name">{r.name}{r.note && <span className="muted small"> · {r.note}</span>}</span>
          {r.value != null && <b>{r.value}</b>}
        </li>
      ))}
    </ol>
  );
}
