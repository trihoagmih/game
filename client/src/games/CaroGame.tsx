import { useEffect, useState } from 'react';
import { colLabel } from '@game/shared/caro';
import { useApp } from '../store.js';
import { useHotkeys } from '../hooks.js';
import Scoreboard, { ScoreLine } from '../components/Scoreboard.js';
import { PlayerBar, MoveList } from '../components/DuelPanels.js';
import GameInfo from '../components/GameInfo.js';
import { RequestOverlay, ResultOverlay, BoardActions } from '../components/BoardRequests.js';
import type { CaroView } from '@game/shared/views';
import type { ClientRoom } from '../store.js';
import './CaroGame.css';
import './BoardColumn.css';

const CELL = 36;
const PAD = 26;
const NAME: Record<string, string> = { x: 'X', o: 'O' };

export default function CaroGame({ room, state: s }: { room: ClientRoom; state: CaroView }) {
  const { act } = useApp();
  const n = s.size;
  const W = n * CELL + PAD * 2;
  const my = s.myColor;
  const opp = my === 'x' ? 'o' : 'x';
  const myTurn = s.status === 'playing' && my && s.turn === my;
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState(() => Math.floor(n / 2) * n + Math.floor(n / 2));
  const [showCursor, setShowCursor] = useState(false);
  const winLine = new Set(s.result?.line || []);

  useEffect(() => { setHover(null); }, [s.moves.length]);

  const place = (i: number) => {
    if (!myTurn || s.board[i] !== '.') return;
    act({ type: 'move', cell: i });
  };
  const moveCursor = (dr: number, dc: number) => {
    setShowCursor(true);
    setCursor((i) => {
      const r = Math.min(n - 1, Math.max(0, Math.floor(i / n) + dr));
      const c = Math.min(n - 1, Math.max(0, (i % n) + dc));
      return r * n + c;
    });
  };
  useHotkeys({
    ArrowUp: () => moveCursor(-1, 0),
    ArrowDown: () => moveCursor(1, 0),
    ArrowLeft: () => moveCursor(0, -1),
    ArrowRight: () => moveCursor(0, 1),
    Enter: () => showCursor && place(cursor),
    ' ': () => showCursor && place(cursor),
    Escape: () => setShowCursor(false),
  });

  const xy = (i: number) => [PAD + (i % n) * CELL, PAD + Math.floor(i / n) * CELL];

  return (
    <div className="bg caro">
      <div className="bg-col caro-main">
        <CaroPlayer side="o" s={s} room={room} />
        <div className="bg-board">
        <svg className="caro-board" viewBox={`0 0 ${W} ${W}`} onMouseLeave={() => setHover(null)}>
          <rect x="0" y="0" width={W} height={W} rx="10" className="caro-bg" />
          {Array.from({ length: n }, (_, k) => (
            <g key={k} className="caro-label">
              <text x={PAD + k * CELL + CELL / 2} y={PAD - 8} textAnchor="middle">{colLabel(k)}</text>
              <text x={PAD - 6} y={PAD + k * CELL + CELL / 2 + 4} textAnchor="end">{n - k}</text>
            </g>
          ))}
          {s.board.map((p, i) => {
            const [x, y] = xy(i);
            const cls = ['caro-cell'];
            if (myTurn && p === '.') cls.push('active');
            if (s.lastMove === i) cls.push('last');
            if (winLine.has(i)) cls.push('win');
            return (
              <g key={i} className={cls.join(' ')} onClick={() => place(i)} onMouseEnter={() => setHover(i)}>
                <rect x={x} y={y} width={CELL} height={CELL} />
                {p !== '.' && <Mark p={p} x={x} y={y} />}
                {p === '.' && myTurn && hover === i && <Mark p={my} x={x} y={y} ghost />}
              </g>
            );
          })}
          {showCursor && (() => {
            const [x, y] = xy(cursor);
            return <rect x={x + 2} y={y + 2} width={CELL - 4} height={CELL - 4} className="caro-cursor" />;
          })()}
        </svg>
        {s.status === 'waiting' && (
          <div className="board-strip" role="status">{s.seats.x && s.seats.o ? 'Chờ sẵn sàng — chủ phòng bấm Bắt đầu…' : 'Đang chờ người chơi ngồi vào ghế… hoặc bấm “Chơi với máy” ở ghế trống'}</div>
        )}
        <RequestOverlay s={s} my={my} opp={opp} />
        <ResultOverlay over={s.status === 'over' && !!s.result} resetKey={s.score?.gameNo}
          title={s.result?.winner ? `${s.result.winnerName || s.seats[s.result.winner]?.name || NAME[s.result.winner]} (${NAME[s.result.winner]}) thắng${my && s.result.winner === my ? ' — bạn thắng!' : ''}` : 'Hòa'}
          detail={s.result?.text}>
          <ScoreLine score={s.score} a={s.seats.x} b={s.seats.o} />
        </ResultOverlay>
        </div>
        <CaroPlayer side="x" s={s} room={room} />
        <BoardActions s={s} my={my} opp={opp} sitLabel="bấm “Ngồi” ở ghế trống để chơi" rematchLabel="Chơi lại (đổi lượt đi)" />
      </div>

      <GameInfo>
        <Scoreboard room={room} score={s.score} playing={s.status === 'playing'}
          sides={{ x: { label: 'X', cls: 'c-x' }, o: { label: 'O', cls: 'c-o' } }} />
        <MoveList moves={s.moves} sides={["x", "o"]} />
        <div className="muted small">
          Bàn {n}×{n} · 5 quân liên tiếp là thắng{s.options.blockTwoEnds ? ' · bị chặn hai đầu không tính' : ''} · {s.options.minutes} phút mỗi bên, hết giờ là thua. X đi trước. Xin đi lại / cầu hòa cần đối thủ đồng ý. Chơi với máy: máy luôn cho đi lại, chỉ đồng ý hòa khi bàn gần kín.
        </div>
      </GameInfo>
    </div>
  );
}

function Mark({ p, x, y, ghost }: { p: string; x: number; y: number; ghost?: boolean }) {
  const m = 9;
  return (
    <g className={`caro-mark ${p} ${ghost ? 'ghost' : ''}`}>
      {p === 'x' ? (
        <>
          <line x1={x + m} y1={y + m} x2={x + CELL - m} y2={y + CELL - m} />
          <line x1={x + CELL - m} y1={y + m} x2={x + m} y2={y + CELL - m} />
        </>
      ) : (
        <circle cx={x + CELL / 2} cy={y + CELL / 2} r={CELL / 2 - m + 1} />
      )}
    </g>
  );
}

function CaroPlayer({ side, s, room }: { side: string; s: CaroView; room: ClientRoom }) {
  return <PlayerBar side={side} s={s} room={room} chip={<span className={`caro-chip ${side}`}>{NAME[side]}</span>} sitLabel={`Ngồi ${NAME[side]}`} bots />;
}
