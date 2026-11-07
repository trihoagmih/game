/**
 * Bàn đánh bài hình bầu dục dùng chung cho các trò bài (Tá lả, Sâm lốc…), cùng ngôn ngữ với bàn Poker.
 * - Ghế xếp quanh bàn theo hình elip; người xem luôn ngồi ở dưới (rel = 0).
 * - Giữa bàn là nội dung chung (nọc bài, bài vừa đánh, trạng thái).
 * - Trên điện thoại (≤640px) bàn chuyển sang dạng dọc: đối thủ ở trên, giữa bàn, rồi ghế của mình.
 *
 * seats: [{ key, rel, node, active, me }]  — rel: vị trí tương đối so với người xem (0 = dưới cùng)
 */
import type { ReactNode } from 'react';
import './CardTable.css';

export interface TableSeat { key: string | number; rel: number; node: ReactNode; active?: boolean; me?: boolean }

export default function CardTable({ seats, center, tableContent, outsideSeats = false, className = '' }: {
  seats: TableSeat[]; center?: ReactNode; tableContent?: ReactNode; outsideSeats?: boolean; className?: string;
}) {
  const n = seats.length;
  if (outsideSeats) {
    return (
      <div className={`ct ct-outside ${className} n${n}`}>
        <div className="ct-outside-opponents">
          {seats.filter((s) => s.rel !== 0).map((s) => (
            <div key={s.key} className={`ct-outside-seat rel-${s.rel} ${s.me ? 'me' : ''} ${s.active ? 'active' : ''}`}>{s.node}</div>
          ))}
        </div>
        <div className="ct-felt">
          <div className="ct-center">{center}</div>
          {tableContent}
        </div>
        {seats.filter((s) => s.rel === 0).map((s) => (
          <div key={s.key} className={`ct-outside-self ${s.me ? 'me' : ''} ${s.active ? 'active' : ''}`}>{s.node}</div>
        ))}
      </div>
    );
  }
  return (
    <div className={`ct ${className} ${tableContent ? 'ct-with-content' : ''}`}>
      <div className={`ct-felt n${n}`}>
        <div className="ct-arena">
        <div className="ct-center">{center}</div>
        {seats.map((s) => {
          const ang = Math.PI / 2 + (s.rel * 2 * Math.PI) / n;
          // Bán kính ngang nhỏ hơn bàn Poker vì ghế bài phỏm / sâm chứa nhiều thông tin hơn
          const style = { left: `${50 + 38 * Math.cos(ang)}%`, top: `${50 + 40 * Math.sin(ang)}%` };
          return (
            <div key={s.key} style={style}
              className={`ct-seat ${s.me ? 'me' : ''} ${s.active ? 'active' : ''} ${s.rel === 0 ? 'bottom' : ''}`}>
              {s.node}
            </div>
          );
        })}
        </div>
        {tableContent}
      </div>
    </div>
  );
}
