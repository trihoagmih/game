import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { legalMovesFrom, colorOf, typeOf, PIECE_CHAR, rowOf, colOf, idx } from '@game/shared/xiangqi';
import { useApp } from '../store.js';
import { useHotkeys } from '../hooks.js';
import Scoreboard, { ScoreLine } from '../components/Scoreboard.js';
import { PlayerBar, MoveList } from '../components/DuelPanels.js';
import GameInfo from '../components/GameInfo.js';
import { RequestOverlay, ResultOverlay, BoardActions } from '../components/BoardRequests.js';
import type { XiangqiView } from '@game/shared/views';
import type { ClientRoom } from '../store.js';
import './XiangqiGame.css';
import './BoardColumn.css';

const CELL = 56;
const PAD = 50; // chừa chỗ cho số cột hai bên
const W = CELL * 8 + PAD * 2;
const H = CELL * 9 + PAD * 2;
const COLOR_NAME: Record<string, string> = { r: 'Đỏ', b: 'Đen' };
const PIECES: Record<string, Record<string, string>> = PIECE_CHAR;

export default function XiangqiGame({ room, state: s }: { room: ClientRoom; state: XiangqiView }) {
  const { act } = useApp();
  const [sel, setSel] = useState<number | null>(null);
  const [manualFlip, setManualFlip] = useState(false);
  const my = s.myColor;
  const flipped = (my === 'b') !== manualFlip;
  const myTurn = s.status === 'playing' && my && s.turn === my;

  useEffect(() => { setSel(null); }, [s.moves.length, s.status]);

  const targets = useMemo(() => {
    if (sel === null || !myTurn) return [];
    return legalMovesFrom({ board: s.board, turn: s.turn, history: [] }, sel);
  }, [sel, myTurn, s.board, s.turn]);

  useHotkeys({ Escape: () => setSel(null), f: () => setManualFlip((f) => !f) });

  const clickPoint = (i: number) => {
    if (!myTurn) return;
    const p = s.board[i];
    if (sel !== null && targets.includes(i)) {
      act({ type: 'move', from: sel, to: i });
      setSel(null);
    } else if (p !== '.' && colorOf(p) === my) {
      setSel(i === sel ? null : i);
    } else {
      setSel(null);
    }
  };

  const pos = (i: number) => {
    let r = rowOf(i), c = colOf(i);
    if (flipped) { r = 9 - r; c = 8 - c; }
    return [PAD + c * CELL, PAD + r * CELL];
  };

  const topColor = flipped ? 'r' : 'b';
  const bottomColor = flipped ? 'b' : 'r';
  const opp = my === 'r' ? 'b' : 'r';
  const checkedKing = s.inCheck ? s.board.indexOf(s.turn === 'r' ? 'K' : 'k') : -1;

  return (
    <div className="bg xq">
      <div className="bg-col xq-main">
        <XiangqiPlayer side={topColor} s={s} room={room} />
        <div className="bg-board">
        <svg className="xq-board" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bàn cờ tướng">
          <BoardDefs />
          <rect x="0" y="0" width={W} height={H} rx="16" fill="url(#xq-frame)" />
          <rect x="7" y="7" width={W - 14} height={H - 14} rx="11" fill="url(#xq-wood)" className="xq-bg" />
          <rect x="7" y="7" width={W - 14} height={H - 14} rx="11" filter="url(#xq-grain)" className="xq-grain" />
          <rect x={PAD} y={PAD + 4 * CELL} width={CELL * 8} height={CELL} className="xq-river-band" />
          <BoardLines />
          <FileLabels flipped={flipped} />
          {s.lastMove && (() => {
            const [fx, fy] = pos(s.lastMove.from);
            const [tx, ty] = pos(s.lastMove.to);
            const c = 27, l = 9; // khung 4 góc quanh ô vừa đến
            return (
              <g className="xq-last" aria-hidden>
                <circle cx={fx} cy={fy} r="7" className="from" />
                {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => (
                  <polyline key={`${sx}${sy}`} points={`${tx + sx * c},${ty + sy * (c - l)} ${tx + sx * c},${ty + sy * c} ${tx + sx * (c - l)},${ty + sy * c}`} />
                ))}
              </g>
            );
          })()}
          {s.board.map((p, i) => {
            const [x, y] = pos(i);
            const isTarget = targets.includes(i);
            return (
              <g key={i} onClick={() => clickPoint(i)} className={myTurn ? 'xq-pt active' : 'xq-pt'}>
                <rect x={x - CELL / 2} y={y - CELL / 2} width={CELL} height={CELL} fill="transparent" />
                {p !== '.' && (
                  <g className={`xq-piece ${colorOf(p)} ${sel === i ? 'sel' : ''} ${checkedKing === i ? 'check' : ''}`}
                    transform={sel === i ? 'translate(0 -3)' : undefined} filter={sel === i ? 'url(#xq-lift)' : 'url(#xq-shadow)'}>
                    <circle cx={x} cy={y} r="25" className="rim" fill="url(#xq-rim)" />
                    <circle cx={x} cy={y} r="21.5" className="disc" fill="url(#xq-disc)" />
                    <circle cx={x} cy={y} r="18.5" className="inner" />
                    <path d={`M ${x - 21} ${y - 4} A 21.5 21.5 0 0 1 ${x + 21} ${y - 4}`} className="bevel" />
                    <text x={x} y={y + 8} textAnchor="middle">{PIECES[colorOf(p)!][typeOf(p)]}</text>
                  </g>
                )}
                {isTarget && (p === '.'
                  ? <circle cx={x} cy={y} r="7" className="xq-dot" />
                  : <circle cx={x} cy={y} r="27" className="xq-cap" />)}
              </g>
            );
          })}
        </svg>
        {s.status === 'playing' && s.inCheck && <div className="board-strip check" role="status">Chiếu tướng!</div>}
        {s.status === 'waiting' && (
          <div className="board-strip" role="status">{s.seats.r && s.seats.b ? 'Chờ sẵn sàng — chủ phòng bấm Bắt đầu…' : 'Đang chờ người chơi ngồi vào ghế…'}</div>
        )}
        <RequestOverlay s={s} my={my} opp={opp} />
        <ResultOverlay over={s.status === 'over' && !!s.result} resetKey={s.score?.gameNo}
          title={s.result?.winner ? `${COLOR_NAME[s.result.winner]} thắng${my && s.result.winner === my ? ' — bạn thắng!' : ''}` : 'Hòa'}
          detail={s.result?.text}>
          <ScoreLine score={s.score} a={s.seats.r} b={s.seats.b} />
        </ResultOverlay>
        </div>
        <XiangqiPlayer side={bottomColor} s={s} room={room} />
        <BoardActions s={s} my={my} opp={opp} sitLabel="bấm “Ngồi” ở ghế trống để chơi" rematchLabel="Chơi lại (đổi màu)"
          extra={<button className="btn ghost ba-icon" onClick={() => setManualFlip((f) => !f)} title="Lật bàn cờ (F)" aria-label="Lật bàn cờ"><ArrowUpDown size={16} aria-hidden /></button>} />
      </div>

      <GameInfo>
        <Scoreboard room={room} score={s.score} playing={s.status === 'playing'}
          sides={{ r: { label: 'Đỏ', cls: 'c-r' }, b: { label: 'Đen', cls: 'c-b' } }} />
        <MoveList moves={s.moves} sides={["r", "b"]} />
        <div className="muted small">Thời gian: {s.options.minutes} phút mỗi bên. Hết giờ là thua. Xin đi lại / cầu hòa cần đối thủ đồng ý.</div>
      </GameInfo>
    </div>
  );
}

function XiangqiPlayer({ side, s, room }: { side: string; s: XiangqiView; room: ClientRoom }) {
  return <PlayerBar side={side} s={s} room={room} chip={<span className={`xq-chip ${side}`}>{PIECES[side].K}</span>} sitLabel={`Ngồi ${COLOR_NAME[side]}`} />;
}

/** Gradient gỗ, mặt quân và bóng đổ (có độ lệch) cho bàn cờ. */
function BoardDefs() {
  return (
    <defs>
      {/* Mặt gỗ sáng, khung gỗ sẫm */}
      <linearGradient id="xq-wood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#f3d8a2" />
        <stop offset=".5" stopColor="#e7c083" />
        <stop offset="1" stopColor="#d9a964" />
      </linearGradient>
      <linearGradient id="xq-frame" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7a4a1f" />
        <stop offset="1" stopColor="#4e2c10" />
      </linearGradient>
      {/* Vân gỗ: nhiễu kéo dài theo chiều ngang, phủ rất nhẹ */}
      <filter id="xq-grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.14" numOctaves="3" seed="7" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.24  0 0 0 0 0.08  0 0 0 0.55 -0.12" />
      </filter>
      {/* Quân: vành gỗ + mặt ngà */}
      <radialGradient id="xq-rim" cx=".4" cy=".3" r=".8">
        <stop offset="0" stopColor="#c58a4a" />
        <stop offset="1" stopColor="#7a4a1c" />
      </radialGradient>
      <radialGradient id="xq-disc" cx=".4" cy=".32" r=".8">
        <stop offset="0" stopColor="#fffaf0" />
        <stop offset=".7" stopColor="#f4e4c3" />
        <stop offset="1" stopColor="#e3c792" />
      </radialGradient>
      <filter id="xq-shadow" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dx="0" dy="2.5" stdDeviation="1.6" floodColor="#3b2208" floodOpacity=".5" />
      </filter>
      <filter id="xq-lift" x="-40%" y="-40%" width="180%" height="190%">
        <feDropShadow dx="0" dy="7" stdDeviation="3.5" floodColor="#3b2208" floodOpacity=".45" />
      </filter>
    </defs>
  );
}

/** Số cột 1–9 kiểu Việt Nam: mỗi bên đếm từ tay phải của mình. */
function FileLabels({ flipped }: { flipped: boolean }) {
  const x = (c: number) => PAD + c * CELL;
  // Cột trên màn hình (trái → phải) ứng với cột trên bàn khi lật
  const boardCol = (c: number) => (flipped ? 8 - c : c);
  return (
    <g className="xq-files" aria-hidden>
      {Array.from({ length: 9 }, (_, c) => (
        <g key={c}>
          <text x={x(c)} y={PAD - 30} textAnchor="middle" className={flipped ? 'r' : 'b'}>{boardCol(c) + 1}</text>
          <text x={x(c)} y={PAD + CELL * 9 + 40} textAnchor="middle" className={flipped ? 'b' : 'r'}>{9 - boardCol(c)}</text>
        </g>
      ))}
    </g>
  );
}

function BoardLines() {
  const L: ReactNode[] = [];
  const x = (c: number) => PAD + c * CELL;
  const y = (r: number) => PAD + r * CELL;
  for (let r = 0; r < 10; r++) L.push(<line key={'h' + r} x1={x(0)} y1={y(r)} x2={x(8)} y2={y(r)} />);
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) L.push(<line key={'v' + c} x1={x(c)} y1={y(0)} x2={x(c)} y2={y(9)} />);
    else {
      L.push(<line key={'v' + c + 'a'} x1={x(c)} y1={y(0)} x2={x(c)} y2={y(4)} />);
      L.push(<line key={'v' + c + 'b'} x1={x(c)} y1={y(5)} x2={x(c)} y2={y(9)} />);
    }
  }
  // Cung tướng
  L.push(<line key="p1" x1={x(3)} y1={y(0)} x2={x(5)} y2={y(2)} />, <line key="p2" x1={x(5)} y1={y(0)} x2={x(3)} y2={y(2)} />);
  L.push(<line key="p3" x1={x(3)} y1={y(7)} x2={x(5)} y2={y(9)} />, <line key="p4" x1={x(5)} y1={y(7)} x2={x(3)} y2={y(9)} />);
  // Dấu vị trí pháo / tốt
  const marks = [[2, 1], [2, 7], [7, 1], [7, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]];
  for (const [r, c] of marks) {
    const d = 5, l = 10;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if ((c === 0 && sx < 0) || (c === 8 && sx > 0)) continue;
      const cx = x(c) + sx * d, cy = y(r) + sy * d;
      L.push(<polyline key={`m${r}${c}${sx}${sy}`} points={`${cx},${cy + sy * l} ${cx},${cy} ${cx + sx * l},${cy}`} fill="none" />);
    }
  }
  return (
    <g className="xq-lines">
      <rect x={x(0) - 8} y={y(0) - 8} width={CELL * 8 + 16} height={CELL * 9 + 16} fill="none" className="frame" />
      <rect x={x(0)} y={y(0)} width={CELL * 8} height={CELL * 9} fill="none" className="edge" />
      {L}
      <text x={x(2)} y={y(4.5) + 9} textAnchor="middle" className="river">楚 河</text>
      <text x={x(6)} y={y(4.5) + 9} textAnchor="middle" className="river">漢 界</text>
    </g>
  );
}

export { idx };
