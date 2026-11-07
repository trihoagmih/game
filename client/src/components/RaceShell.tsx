import { useState } from 'react';
import { Flag, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RacePlayerView, RaceView } from '@game/shared/race';
import type { ClientRoom } from '../store.js';
import { useRoomApp } from '../store.js';
import GameInfo from './GameInfo.js';
import ConfirmDialog from './ConfirmDialog.js';
import StartBar, { ReadyMark } from './StartBar.js';
import GameOverDialog, { GoRanking } from './GameOverDialog.js';
import './Scoreboard.css';
import './RaceShell.css';

// Khung chung của các trò đua song song (Bay qua khe, Đào vàng): dải người đua, thanh công cụ, sân chơi
// co theo vùng chơi, nút bắt đầu/vào chơi và popup kết quả. Bảng thành tích + luật nằm ở panel thông
// tin để dành chỗ cho sân chơi.

type AnyRaceView = RaceView<object, RacePlayerView>;

interface RaceShellProps {
  room: ClientRoom;
  s: AnyRaceView;
  /** Lớp riêng của trò (prefix CSS) — quyết định tỉ lệ khung sân chơi. */
  className: string;
  /** Mô tả ngắn trạng thái của một người dưới tên (vd. "Màn 2 · 1.250$"). */
  note: (p: RacePlayerView) => string;
  /** Hiển thị điểm (vd. "12 khe", "1.250$"). */
  formatScore: (score: number) => string;
  /** Người đang được hiển thị trên sân chơi; null khi chưa có ván. */
  shownId: string | null;
  onPick: ((id: string) => void) | null;
  toolbar?: ReactNode;
  stage: ReactNode;
  controls?: ReactNode;
  rules: ReactNode;
}

export const END_LABEL: Record<NonNullable<RacePlayerView['end']>, string> = {
  dead: 'Dừng', finished: 'Về đích', gaveUp: 'Bỏ cuộc', timedOut: 'Hết giờ',
};

export default function RaceShell({ room, s, className, note, formatScore, shownId, onPick, toolbar, stage, controls, rules }: RaceShellProps) {
  const { call, user } = useRoomApp();
  const [giveup, setGiveup] = useState(false);
  const playing = s.status === 'playing';
  const me = s.players.find((p) => p.id === s.myId);
  const canPlay = playing && me && !me.done;
  const startLabel = s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu';
  const canSit = !s.myId && s.seats.length < s.options.maxSeats;

  return (
    <div className={`rc ${className}`}>
      <Roster s={s} ownerId={room.ownerId} shownId={shownId} onPick={onPick} note={note} formatScore={formatScore} />

      <div className="rc-bar">
        {toolbar}
        <span className="rc-sp" />
        {canPlay && (
          <button className="btn sm danger rc-icon" onClick={() => setGiveup(true)} title="Bỏ cuộc" aria-label="Bỏ cuộc">
            <Flag size={16} aria-hidden />
          </button>
        )}
      </div>

      <div className="rc-stage">{stage}</div>

      {controls}

      {!playing && s.status !== 'over' && (
        <div className="rc-actions">
          {s.myId
            ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : canSit && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}
          <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} min={1} startLabel={startLabel} />
        </div>
      )}
      {playing && !s.myId && <p className="muted small rc-hint">Bạn đang xem — chọn tên người chơi để xem màn của họ.</p>}

      {s.status === 'over' && s.result && (
        <GameOverDialog over icon={<Trophy size={26} />} title={resultTitle(s, user.id, formatScore)} min={1}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} reviewLabel="Xem lại màn chơi"
          seatBtn={s.myId ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : canSit && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}>
          <GoRanking me={user.id} rows={s.result.ranking.map((id) => {
            const p = s.players.find((x) => x.id === id);
            return { id, name: p?.name ?? '?', value: formatScore(p?.score ?? 0), note: p?.end ? END_LABEL[p.end] : '' };
          })} />
        </GameOverDialog>
      )}

      {giveup && (
        <ConfirmDialog title="Bỏ cuộc ván này?" danger okLabel="Bỏ cuộc" icon={<Flag size={22} />}
          onOk={() => call('game:action', { type: 'giveup' })} onClose={() => setGiveup(false)}>
          Điểm hiện tại được giữ, nhưng bạn xếp sau người cùng điểm còn chơi tới cùng.
        </ConfirmDialog>
      )}

      <GameInfo>
        <Wins s={s} me={user.id} formatScore={formatScore} />
        <div className="panel small muted rc-rules"><b>Luật chơi</b>{rules}</div>
      </GameInfo>
    </div>
  );
}

function resultTitle(s: AnyRaceView, me: string, formatScore: (n: number) => string) {
  const winner = s.players.find((p) => p.id === s.result?.winner);
  if (s.players.length === 1) return `Kết quả: ${formatScore(s.players[0].score)}`;
  if (!winner) return 'Không ai thắng';
  return winner.id === me ? 'Bạn thắng!' : `${winner.name} thắng!`;
}

function Roster({ s, ownerId, shownId, onPick, note, formatScore }: {
  s: AnyRaceView; ownerId: string; shownId: string | null; onPick: ((id: string) => void) | null;
  note: (p: RacePlayerView) => string; formatScore: (n: number) => string;
}) {
  const racing = s.status !== 'waiting' && s.players.length > 0;
  const rows = racing ? s.players : s.seats.map((x) => ({ ...x, score: 0, done: false, end: null }));
  if (!rows.length) return <p className="muted small rc-roster-empty">Chưa có ai ngồi — bấm “Vào chơi”.</p>;
  return (
    <ul className="rc-roster" aria-label="Người chơi">
      {rows.map((p) => {
        const mine = p.id === s.myId;
        const body = (
          <>
            <span className="rc-name">{p.name}{mine && <span className="muted"> (bạn)</span>}</span>
            {!racing && <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />}
            {racing && 'tick' in p && <span className="rc-note">{p.end ? END_LABEL[p.end] : note(p)} · <b>{formatScore(p.score)}</b></span>}
          </>
        );
        const cls = `rc-racer${mine ? ' me' : ''}${p.id === shownId ? ' shown' : ''}${p.done ? ' out' : ''}`;
        return (
          <li key={p.id}>
            {onPick && racing
              ? <button type="button" className={cls} aria-pressed={p.id === shownId} onClick={() => onPick(p.id)}>{body}</button>
              : <div className={cls}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function Wins({ s, me, formatScore }: { s: AnyRaceView; me: string; formatScore: (n: number) => string }) {
  if (!s.wins.length) return null;
  return (
    <div className="panel">
      <h4>Bảng thành tích</h4>
      <table className="sb-table">
        <thead><tr><th>#</th><th>Người chơi</th><th>Ván</th><th>Thắng</th><th>Cao nhất</th></tr></thead>
        <tbody>
          {s.wins.map((w, i) => (
            <tr key={w.id} className={w.id === me ? 'me' : ''}>
              <td>{i === 0 && w.wins > 0 ? <Trophy size={14} aria-label="Dẫn đầu" /> : i + 1}</td>
              <td className="sb-name">{w.name}</td>
              <td>{w.games}</td>
              <td><b>{w.wins}</b></td>
              <td>{formatScore(w.best)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
