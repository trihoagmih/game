import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Undo2, Handshake, Flag, RotateCcw, ArrowUpDown } from 'lucide-react';
import { legalMovesFrom, colorOf, typeOf, PIECE_CHAR, rowOf, colOf, idx } from '@game/shared/xiangqi';
import { useApp } from '../store.jsx';
import { useCountdown, useHotkeys, fmtClock } from '../hooks.js';
import Scoreboard from '../components/Scoreboard.jsx';

const CELL = 56;
const PAD = 40;
const W = CELL * 8 + PAD * 2;
const H = CELL * 9 + PAD * 2;
const COLOR_NAME = { r: 'Đỏ', b: 'Đen' };

export default function XiangqiGame({ room, state: s }) {
  const { act, call, user } = useApp();
  const [sel, setSel] = useState(null);
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

  const clickPoint = (i) => {
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

  const pos = (i) => {
    let r = rowOf(i), c = colOf(i);
    if (flipped) { r = 9 - r; c = 8 - c; }
    return [PAD + c * CELL, PAD + r * CELL];
  };

  const topColor = flipped ? 'r' : 'b';
  const bottomColor = flipped ? 'b' : 'r';
  const opp = my === 'r' ? 'b' : 'r';
  const pending = s.pending;
  const checkedKing = s.inCheck ? s.board.indexOf(s.turn === 'r' ? 'K' : 'k') : -1;

  return (
    <div className="xq">
      <div className="xq-main">
        <PlayerBar color={topColor} s={s} room={room} />
        <svg className="xq-board" viewBox={`0 0 ${W} ${H}`}>
          <rect x="0" y="0" width={W} height={H} rx="10" className="xq-bg" />
          <BoardLines />
          {s.lastMove && [s.lastMove.from, s.lastMove.to].map((i, k) => {
            const [x, y] = pos(i);
            return <rect key={k} x={x - 26} y={y - 26} width="52" height="52" className="xq-last" rx="6" />;
          })}
          {s.board.map((p, i) => {
            const [x, y] = pos(i);
            const isTarget = targets.includes(i);
            return (
              <g key={i} onClick={() => clickPoint(i)} className={myTurn ? 'xq-pt active' : 'xq-pt'}>
                <rect x={x - CELL / 2} y={y - CELL / 2} width={CELL} height={CELL} fill="transparent" />
                {p !== '.' && (
                  <g className={`xq-piece ${colorOf(p)} ${sel === i ? 'sel' : ''} ${checkedKing === i ? 'check' : ''}`}>
                    <circle cx={x} cy={y} r="24" />
                    <circle cx={x} cy={y} r="20" className="inner" />
                    <text x={x} y={y + 8} textAnchor="middle">{PIECE_CHAR[colorOf(p)][typeOf(p)]}</text>
                  </g>
                )}
                {isTarget && (p === '.' ? <circle cx={x} cy={y} r="8" className="xq-dot" /> : <circle cx={x} cy={y} r="27" className="xq-cap" />)}
              </g>
            );
          })}
        </svg>
        <PlayerBar color={bottomColor} s={s} room={room} />
      </div>

      <div className="xq-side">
        <div className="panel">
          {s.status === 'waiting' && (
            <div className="xq-status">
              {s.seats.r && s.seats.b ? 'Chờ hai bên sẵn sàng…' : 'Đang chờ người chơi…'}
            </div>
          )}
          {s.status === 'playing' && (
            <div className="xq-status">
              Lượt: <b className={`c-${s.turn}`}>{COLOR_NAME[s.turn]}</b>
              {s.inCheck && <span className="check-badge">CHIẾU!</span>}
              {myTurn && <span className="your-turn"> — tới lượt bạn</span>}
            </div>
          )}
          {s.status === 'over' && s.result && (
            <div className="xq-result">
              <div className="big">
                {s.result.winner ? <>{COLOR_NAME[s.result.winner]} thắng{my && (s.result.winner === my ? ' 🎉' : '')}</> : 'Hòa'}
              </div>
              <div className="muted">{s.result.text}</div>
            </div>
          )}

          {pending && my && pending.from === opp && (
            <div className="request">
              <b>{s.seats[opp]?.name}</b> {pending.type === 'draw' ? 'xin cầu hòa' : 'xin đi lại'}.
              <div className="row">
                <button className="btn primary sm" onClick={() => act({ type: 'respond', accept: true })}>Đồng ý</button>
                <button className="btn sm" onClick={() => act({ type: 'respond', accept: false })}>Từ chối</button>
              </div>
            </div>
          )}
          {pending && my && pending.from === my && (
            <div className="request mine">
              Đang chờ đối thủ trả lời {pending.type === 'draw' ? 'cầu hòa' : 'xin đi lại'}…
              <button className="btn sm" onClick={() => act({ type: 'cancelRequest' })}>Hủy</button>
            </div>
          )}
          {pending && !my && <div className="muted small">{COLOR_NAME[pending.from]} đang {pending.type === 'draw' ? 'cầu hòa' : 'xin đi lại'}…</div>}

          {my && (
            <div className="xq-actions">
              {s.status === 'waiting' && (
                <button className={`btn ${s.ready[my] ? '' : 'primary'}`} onClick={() => act({ type: 'ready' })} disabled={!s.seats[opp]}>
                  {s.ready[my] ? 'Hủy sẵn sàng' : <><Check size={16} aria-hidden /> Sẵn sàng</>}
                </button>
              )}
              {s.status === 'playing' && (
                <>
                  <button className="btn" disabled={!!pending} onClick={() => act({ type: 'requestUndo' })}><Undo2 size={16} aria-hidden /> Xin đi lại</button>
                  <button className="btn" disabled={!!pending} onClick={() => act({ type: 'offerDraw' })}><Handshake size={16} aria-hidden /> Cầu hòa</button>
                  <button className="btn danger" onClick={() => confirm('Bạn chắc chắn muốn xin thua?') && act({ type: 'resign' })}><Flag size={16} aria-hidden /> Xin thua</button>
                </>
              )}
              {s.status === 'over' && (
                <button className="btn primary" disabled={s.rematch[my] || !s.seats[opp]} onClick={() => act({ type: 'rematch' })}>
                  {s.rematch[my] ? 'Đang chờ đối thủ…' : s.rematch[opp] ? <><RotateCcw size={16} aria-hidden /> Đồng ý chơi lại</> : <><RotateCcw size={16} aria-hidden /> Chơi lại (đổi màu)</>}
                </button>
              )}
              {s.status !== 'playing' && <button className="btn ghost" onClick={() => call('room:stand')}>Đứng dậy xem</button>}
            </div>
          )}
          {!my && <div className="muted small">Bạn đang xem. Ngồi vào ghế trống để chơi.</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn ghost sm" onClick={() => setManualFlip((f) => !f)}><ArrowUpDown size={16} aria-hidden /> Lật bàn <kbd>F</kbd></button>
          </div>
        </div>
        <Scoreboard room={room} score={s.score} playing={s.status === 'playing'}
          sides={{ r: { label: 'Đỏ', cls: 'c-r' }, b: { label: 'Đen', cls: 'c-b' } }} />
        <MoveList moves={s.moves} />
        <div className="muted small">Thời gian: {s.options.minutes} phút mỗi bên. Hết giờ là thua.</div>
      </div>
    </div>
  );

}

function PlayerBar({ color, s, room }) {
  const { call, user } = useApp();
  const my = s.myColor;
  const seat = s.seats[color];
  const running = s.running && s.turn === color;
  const ms = useCountdown(s.clocks[color], room.receivedAt, running);
  const low = ms < 60000;
  const member = seat && room.members.find((m) => m.id === seat.id);
  return (
    <div className={`xq-player ${running ? 'active' : ''}`}>
      <span className={`xq-chip ${color}`}>{PIECE_CHAR[color].K}</span>
      {seat ? (
        <span className="pname">
          {seat.name}{seat.id === user.id && ' (bạn)'}
          {member && !member.online && <span className="muted"> (mất kết nối)</span>}
          {s.status === 'waiting' && s.ready[color] && <span className="ready"> ✔ sẵn sàng</span>}
          {s.status === 'over' && s.rematch[color] && <span className="ready"> ↻ muốn chơi lại</span>}
        </span>
      ) : (
        <span className="pname muted">
          Ghế trống {!my && s.status !== 'playing' && (
            <button className="btn primary sm" onClick={() => call('room:sit', { seat: color })}>Ngồi {COLOR_NAME[color]}</button>
          )}
        </span>
      )}
      <span className={`clock ${running ? 'running' : ''} ${low && running ? 'low' : ''}`}>{fmtClock(ms)}</span>
    </div>
  );
}

function MoveList({ moves }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [moves.length]);
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([i / 2 + 1, moves[i], moves[i + 1]]);
  return (
    <div className="panel moves">
      <h4>Biên bản ({moves.length} nước)</h4>
      <div className="move-list" ref={ref}>
        {rows.length === 0 && <div className="muted small">Chưa có nước đi</div>}
        {rows.map(([n, a, b]) => (
          <div key={n} className="move-row">
            <span className="muted">{n}.</span>
            <span className="c-r">{a?.san}</span>
            <span className="c-b">{b?.san || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardLines() {
  const L = [];
  const x = (c) => PAD + c * CELL;
  const y = (r) => PAD + r * CELL;
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
      <rect x={x(0) - 6} y={y(0) - 6} width={CELL * 8 + 12} height={CELL * 9 + 12} fill="none" strokeWidth="3" />
      {L}
      <text x={x(2)} y={y(4.5) + 9} textAnchor="middle" className="river">楚 河</text>
      <text x={x(6)} y={y(4.5) + 9} textAnchor="middle" className="river">漢 界</text>
    </g>
  );
}

export { idx };
