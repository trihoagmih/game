import { useEffect, useRef, useState } from 'react';
import { Check, Undo2, Handshake, Flag, RotateCcw, ArrowUpDown } from 'lucide-react';
import { colLabel } from '@game/shared/caro';
import { useApp } from '../store.jsx';
import { useCountdown, useHotkeys, fmtClock } from '../hooks.js';
import Scoreboard from '../components/Scoreboard.jsx';

const CELL = 36;
const PAD = 26;
const NAME = { x: 'X', o: 'O' };

export default function CaroGame({ room, state: s }) {
  const { act, call } = useApp();
  const n = s.size;
  const W = n * CELL + PAD * 2;
  const my = s.myColor;
  const opp = my === 'x' ? 'o' : 'x';
  const myTurn = s.status === 'playing' && my && s.turn === my;
  const [hover, setHover] = useState(null);
  const [cursor, setCursor] = useState(() => Math.floor(n / 2) * n + Math.floor(n / 2));
  const [showCursor, setShowCursor] = useState(false);
  const pending = s.pending;
  const winLine = new Set(s.result?.line || []);

  useEffect(() => { setHover(null); }, [s.moves.length]);

  const place = (i) => {
    if (!myTurn || s.board[i] !== '.') return;
    act({ type: 'move', cell: i });
  };
  const moveCursor = (dr, dc) => {
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

  const xy = (i) => [PAD + (i % n) * CELL, PAD + Math.floor(i / n) * CELL];

  return (
    <div className="xq caro">
      <div className="xq-main caro-main">
        <PlayerBar color="o" s={s} room={room} />
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
        <PlayerBar color="x" s={s} room={room} />
      </div>

      <div className="xq-side">
        <div className="panel">
          {s.status === 'waiting' && (
            <div className="xq-status">{s.seats.x && s.seats.o ? 'Chờ hai bên sẵn sàng…' : 'Đang chờ người chơi…'}</div>
          )}
          {s.status === 'playing' && (
            <div className="xq-status">
              Lượt: <b className={`c-${s.turn}`}>{NAME[s.turn]}</b>
              {myTurn && <span className="your-turn"> — tới lượt bạn</span>}
            </div>
          )}
          {s.status === 'over' && s.result && (
            <div className="xq-result">
              <div className="big">
                {s.result.winner ? <>{s.seats[s.result.winner]?.name || NAME[s.result.winner]} ({NAME[s.result.winner]}) thắng{my && s.result.winner === my ? ' 🎉' : ''}</> : 'Hòa'}
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
          {pending && !my && <div className="muted small">{NAME[pending.from]} đang {pending.type === 'draw' ? 'cầu hòa' : 'xin đi lại'}…</div>}

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
                  {s.rematch[my] ? 'Đang chờ đối thủ…' : s.rematch[opp] ? <><RotateCcw size={16} aria-hidden /> Đồng ý chơi lại</> : <><RotateCcw size={16} aria-hidden /> Chơi lại (đổi lượt đi)</>}
                </button>
              )}
              {s.status !== 'playing' && <button className="btn ghost" onClick={() => call('room:stand')}>Đứng dậy xem</button>}
            </div>
          )}
          {!my && <div className="muted small">Bạn đang xem. Ngồi vào ghế trống để chơi.</div>}
        </div>
        <Scoreboard room={room} score={s.score} playing={s.status === 'playing'}
          sides={{ x: { label: 'X', cls: 'c-x' }, o: { label: 'O', cls: 'c-o' } }} />
        <MoveList moves={s.moves} />
        <div className="muted small">
          Bàn {n}×{n} · 5 quân liên tiếp là thắng{s.options.blockTwoEnds ? ' · bị chặn hai đầu không tính' : ''} · {s.options.minutes} phút mỗi bên, hết giờ là thua. X đi trước.
        </div>
      </div>
    </div>
  );
}

function Mark({ p, x, y, ghost }) {
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

function PlayerBar({ color, s, room }) {
  const { call, user } = useApp();
  const my = s.myColor;
  const seat = s.seats[color];
  const running = s.running && s.turn === color;
  const ms = useCountdown(s.clocks[color], room.receivedAt, running);
  const member = seat && room.members.find((m) => m.id === seat.id);
  return (
    <div className={`xq-player ${running ? 'active' : ''}`}>
      <span className={`caro-chip ${color}`}>{NAME[color]}</span>
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
            <button className="btn primary sm" onClick={() => call('room:sit', { seat: color })}>Ngồi {NAME[color]}</button>
          )}
        </span>
      )}
      <span className={`clock ${running ? 'running' : ''} ${ms < 60000 && running ? 'low' : ''}`}>{fmtClock(ms)}</span>
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
        {rows.map(([k, a, b]) => (
          <div key={k} className="move-row">
            <span className="muted">{k}.</span>
            <span className="c-x">{a?.san}</span>
            <span className="c-o">{b?.san || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
