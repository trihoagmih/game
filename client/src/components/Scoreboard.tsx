import { useState } from 'react';
import { useRoomApp } from '../store.js';
import type { ScoreboardView } from '@game/shared/views';
import type { Identity } from '@game/shared/contracts';
import { fmtTime } from '../format.js';
import './Scoreboard.css';

export const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n) || ''}½`);

/**
 * Bảng điểm cho game 2 người. `sides` = { r: { label, cls }, b: {...} } để hiển thị màu quân trong lịch sử.
 */
/** Điểm của một người trong phòng (null nếu chưa có ván nào). */
export const pointsOf = (score: ScoreboardView | null | undefined, id: string) => {
  const r = score?.rows?.find((x) => x.id === id);
  return r ? r.points : null;
};

/** Dòng tỉ số ngắn "An 2 – 1 Bình" cho hai ghế (theo thứ tự truyền vào). */
export function ScoreLine({ score, a, b }: { score: ScoreboardView | null | undefined; a: Identity | null | undefined; b: Identity | null | undefined }) {
  if (!a || !b || !score?.gameNo) return null;
  return (
    <div className="score-line" aria-label={`Tỉ số: ${a.name} ${fmtPts(pointsOf(score, a.id) ?? 0)}, ${b.name} ${fmtPts(pointsOf(score, b.id) ?? 0)}`}>
      <span className="sl-name">{a.name}</span>
      <b className="sl-pts">{fmtPts(pointsOf(score, a.id) ?? 0)} – {fmtPts(pointsOf(score, b.id) ?? 0)}</b>
      <span className="sl-name">{b.name}</span>
    </div>
  );
}

export default function Scoreboard({ room, score, sides, playing }: {
  room: { ownerId: string }; score: ScoreboardView; sides: Record<string, { label: string; cls: string }>; playing: boolean;
}) {
  const { user, act } = useRoomApp();
  const [tab, setTab] = useState('table');
  const isOwner = room.ownerId === user.id;
  const { rows, history } = score;

  return (
    <div className="panel scoreboard">
      <div className="sb-head">
        <h4>Bảng điểm {score.gameNo > 0 && <span className="muted">({score.gameNo} ván)</span>}</h4>
        <div className="tabs sm">
          <button className={`tab ${tab === 'table' ? 'active' : ''}`} onClick={() => setTab('table')}>Tỉ số</button>
          <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>Lịch sử</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="muted small">Chưa có ván nào kết thúc. Thắng +1 điểm, hòa +½, thua 0.</div>
      ) : tab === 'table' ? (
        <table className="sb-table">
          <thead>
            <tr><th>#</th><th>Người chơi</th><th title="Số ván">V</th><th title="Thắng">T</th><th title="Hòa">H</th><th title="Thua">B</th><th>Điểm</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={r.id === user.id ? 'me' : ''}>
                <td>{i === 0 && r.points > 0 ? '🏆' : i + 1}</td>
                <td className="sb-name">{r.name}</td>
                <td>{r.games}</td>
                <td className="pos">{r.wins}</td>
                <td>{r.draws}</td>
                <td className="neg">{r.losses}</td>
                <td><b>{fmtPts(r.points)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="sb-history">
          {history.map((h) => {
            const winner = h.players.find((p) => p.id === h.winnerId);
            return (
              <li key={h.no}>
                <span className="muted">#{h.no} · {fmtTime(h.ts)}</span>
                <div>
                  {h.players.map((p, k) => (
                    <span key={p.id}>
                      {k > 0 && <span className="muted"> vs </span>}
                      <span className={sides[p.side]?.cls}>{p.name}</span>
                    </span>
                  ))}
                </div>
                <div className="small">
                  {winner ? <><b>{winner.name}</b> ({sides[winner.side]?.label}) thắng</> : <b>Hòa</b>}
                  <span className="muted"> — {h.reason}{h.moves ? ` · ${h.moves} nước` : ''}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {isOwner && rows.length > 0 && (
        <button className="btn ghost sm" disabled={playing}
          onClick={() => confirm('Đặt lại toàn bộ bảng điểm của phòng?') && act({ type: 'resetScore' })}>
          ↺ Đặt lại bảng điểm
        </button>
      )}
    </div>
  );
}
