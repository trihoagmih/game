import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Undo2, Handshake, Flag, RotateCcw, ArrowUpDown } from 'lucide-react';
import { legalMovesFrom, colorOf, typeOf, rowOf, colOf } from '@game/shared/chess';
import { useApp, useRoomApp } from '../store.js';
import type { ClientRoom } from '../store.js';
import type { ChessColor, ChessMoveView, ChessView } from '@game/shared/views';
import { useCountdown, useHotkeys, fmtClock } from '../hooks.js';
import Scoreboard, { ScoreLine, pointsOf, fmtPts } from '../components/Scoreboard.js';
import './ChessGame.css';

const CELL = 60;
const PAD = 22; // chỗ cho nhãn tọa độ a-h, 1-8
const SIZE = CELL * 8 + PAD * 2;
const COLOR_NAME: Record<string, string> = { w: 'Trắng', b: 'Đen' };

const PIECE_VALUES: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const STARTING_COUNTS: Record<string, number> = { P: 8, N: 2, B: 2, R: 2, Q: 1 };

type Captured = { pieces: string[]; lead: number };

export default function ChessGame({ room, state: s }: { room: ClientRoom; state: ChessView }) {
  const { act, call } = useApp();
  const [sel, setSel] = useState<number | null>(null);
  const [manualFlip, setManualFlip] = useState(false);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null); // { from, to } nếu đang chờ chọn quân phong cấp

  const my = s.myColor;
  const flipped = (my === 'b') !== manualFlip;
  const myTurn = s.status === 'playing' && my && s.turn === my;

  useEffect(() => {
    setSel(null);
    setPromo(null);
  }, [s.moves.length, s.status]);

  const targets = useMemo(() => {
    if (sel === null || !myTurn) return [];
    return legalMovesFrom(
      {
        board: s.board,
        turn: s.turn,
        castling: { w: { k: true, q: true }, b: { k: true, q: true } },
        enPassant: null,
        
      },
      sel
    );
  }, [sel, myTurn, s.board, s.turn]);

  useHotkeys({
    Escape: () => { setSel(null); setPromo(null); },
    f: () => setManualFlip((f) => !f),
  });

  const clickSquare = (i: number) => {
    if (!myTurn || promo) return;
    const p = s.board[i];

    if (sel !== null && targets.includes(i)) {
      const piece = s.board[sel];
      const isPawn = typeOf(piece) === 'P';
      const destRow = rowOf(i);
      const isPromo = isPawn && (destRow === 0 || destRow === 7);

      if (isPromo) {
        setPromo({ from: sel, to: i });
      } else {
        act({ type: 'move', from: sel, to: i, promotion: 'Q' });
        setSel(null);
      }
    } else if (p !== '.' && colorOf(p) === my) {
      setSel(i === sel ? null : i);
    } else {
      setSel(null);
    }
  };

  const choosePromo = (pieceType: string) => {
    if (!promo) return;
    act({ type: 'move', from: promo.from, to: promo.to, promotion: pieceType });
    setPromo(null);
    setSel(null);
  };

  const pos = (i: number) => {
    let r = rowOf(i), c = colOf(i);
    if (flipped) {
      r = 7 - r;
      c = 7 - c;
    }
    return [PAD + c * CELL, PAD + r * CELL];
  };

  const topColor: ChessColor = flipped ? 'w' : 'b';
  const bottomColor: ChessColor = flipped ? 'b' : 'w';
  const opp = my === 'w' ? 'b' : 'w';
  const pending = s.pending;
  const checkedKing = s.inCheck ? s.board.indexOf(s.turn === 'w' ? 'K' : 'k') : -1;

  // Tính quân bị bắt và chênh lệch điểm
  const captured = useMemo((): Record<ChessColor, Captured> => {
    const curW: Record<string, number> = { P: 0, N: 0, B: 0, R: 0, Q: 0 };
    const curB: Record<string, number> = { P: 0, N: 0, B: 0, R: 0, Q: 0 };
    for (const p of s.board) {
      if (p !== '.') {
        const c = colorOf(p);
        const t = typeOf(p);
        if (t !== 'K') {
          if (c === 'w') curW[t!]++;
          else curB[t!]++;
        }
      }
    }
    const capByWhite: string[] = [];
    const capByBlack: string[] = [];
    let scoreW = 0, scoreB = 0;

    for (const t of ['Q', 'R', 'B', 'N', 'P']) {
      const lostB = STARTING_COUNTS[t] - curB[t];
      for (let k = 0; k < lostB; k++) {
        capByWhite.push(t);
        scoreW += PIECE_VALUES[t];
      }
      const lostW = STARTING_COUNTS[t] - curW[t];
      for (let k = 0; k < lostW; k++) {
        capByBlack.push(t);
        scoreB += PIECE_VALUES[t];
      }
    }
    return {
      w: { pieces: capByWhite, lead: scoreW > scoreB ? scoreW - scoreB : 0 },
      b: { pieces: capByBlack, lead: scoreB > scoreW ? scoreB - scoreW : 0 },
    };
  }, [s.board]);

  return (
    <div className="chess-wrap">
      <div className="chess-main">
        <PlayerBar color={topColor} s={s} room={room} captured={captured[topColor]} />

        <div className="chess-board-container">
          <svg className="chess-board" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Bàn cờ vua">
            <BoardDefs />
            {/* Viền ngoài bàn cờ */}
            <rect x="0" y="0" width={SIZE} height={SIZE} rx="12" fill="url(#chess-frame)" />
            <rect x="4" y="4" width={SIZE - 8} height={SIZE - 8} rx="10" fill="#2d1c10" stroke="rgba(255,255,255,.08)" strokeWidth="1" />

            {/* 64 ô cờ */}
            {Array.from({ length: 64 }).map((_, i) => {
              const [x, y] = pos(i);
              const r = rowOf(i), c = colOf(i);
              const isLight = (r + c) % 2 === 0;

              return (
                <rect
                  key={`sq-${i}`}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  fill={isLight ? 'url(#chess-light)' : 'url(#chess-dark)'}
                />
              );
            })}

            {/* Tô màu nước vừa đi */}
            {s.lastMove && [s.lastMove.from, s.lastMove.to].map((sq, idx) => {
              const [x, y] = pos(sq);
              return (
                <rect
                  key={`last-${idx}`}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  fill="rgba(250, 204, 21, 0.35)"
                  stroke="rgba(234, 179, 8, 0.6)"
                  strokeWidth="1.5"
                />
              );
            })}

            {/* Ô đang chọn */}
            {sel !== null && (() => {
              const [x, y] = pos(sel);
              return (
                <rect
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  fill="rgba(59, 130, 246, 0.4)"
                  stroke="#3b82f6"
                  strokeWidth="2"
                />
              );
            })()}

            {/* Vua bị chiếu */}
            {checkedKing >= 0 && (() => {
              return (
                <radialGradient id="check-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(239, 68, 68, 0.85)" />
                  <stop offset="70%" stopColor="rgba(220, 38, 38, 0.5)" />
                  <stop offset="100%" stopColor="rgba(185, 28, 28, 0)" />
                </radialGradient>
              );
            })()}
            {checkedKing >= 0 && (() => {
              const [x, y] = pos(checkedKing);
              return (
                <rect
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  fill="url(#check-glow)"
                />
              );
            })()}

            {/* Nhãn tọa độ a-h, 1-8 */}
            <CoordinateLabels flipped={flipped} />

            {/* Quân cờ và điểm nhấp */}
            {s.board.map((p, i) => {
              const [x, y] = pos(i);
              const isTarget = targets.includes(i);
              const hasPiece = p !== '.';

              return (
                <g key={i} onClick={() => clickSquare(i)} className={myTurn ? 'chess-sq active' : 'chess-sq'}>
                  <rect x={x} y={y} width={CELL} height={CELL} fill="transparent" />

                  {/* Render quân cờ */}
                  {hasPiece && (
                    <g transform={`translate(${x + CELL / 2}, ${y + CELL / 2})`}>
                      <ChessPiece piece={p} size={CELL * 0.76} />
                    </g>
                  )}

                  {/* Chỉ báo nước đi hợp lệ */}
                  {isTarget && (
                    hasPiece ? (
                      // Bắt quân: vòng tròn góc hoặc viền nổi
                      <circle
                        cx={x + CELL / 2}
                        cy={y + CELL / 2}
                        r={CELL * 0.42}
                        fill="none"
                        stroke="rgba(239, 68, 68, 0.85)"
                        strokeWidth="3.5"
                        strokeDasharray="6 3"
                      />
                    ) : (
                      // Đi vào ô trống: chấm tròn
                      <circle
                        cx={x + CELL / 2}
                        cy={y + CELL / 2}
                        r={CELL * 0.16}
                        fill="rgba(34, 197, 94, 0.75)"
                        stroke="rgba(255, 255, 255, 0.4)"
                        strokeWidth="1"
                      />
                    )
                  )}
                </g>
              );
            })}
          </svg>

          {/* Popup chọn quân khi phong cấp */}
          {promo && (
            <div className="promo-overlay">
              <div className="promo-dialog">
                <h4>Phong cấp tốt</h4>
                <p className="muted small">Chọn quân bạn muốn nâng cấp:</p>
                <div className="promo-choices">
                  {['Q', 'R', 'B', 'N'].map((type) => (
                    <button
                      key={type}
                      className="promo-btn"
                      onClick={() => choosePromo(type)}
                      title={`Phong thành ${my ? COLOR_NAME[my] : ''} ${type}`}
                    >
                      <svg width="44" height="44" viewBox="0 0 44 44">
                        <g transform="translate(22, 22)">
                          <ChessPiece piece={my === 'w' ? type : type.toLowerCase()} size={36} />
                        </g>
                      </svg>
                      <span>{type === 'Q' ? 'Hậu' : type === 'R' ? 'Xe' : type === 'B' ? 'Tượng' : 'Mã'}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <PlayerBar color={bottomColor} s={s} room={room} captured={captured[bottomColor]} />
      </div>

      <div className="chess-side">
        <div className="panel">
          {s.status === 'waiting' && (
            <div className="chess-status" role="status" aria-live="polite">
              {s.seats.w && s.seats.b ? 'Chờ hai bên sẵn sàng…' : 'Đang chờ người chơi…'}
            </div>
          )}
          {s.status === 'playing' && (
            <div className="chess-status" role="status" aria-live="polite">
              Lượt: <b className={`c-${s.turn}`}>{COLOR_NAME[s.turn]}</b>
              {s.inCheck && <span className="check-badge">CHIẾU!</span>}
              {myTurn && <span className="your-turn"> — tới lượt bạn</span>}
            </div>
          )}
          {s.status === 'over' && s.result && (
            <div className="chess-result">
              <div className="big">
                {s.result.winner ? (
                  <>{COLOR_NAME[s.result.winner]} thắng{my && (s.result.winner === my ? ' 🎉' : '')}</>
                ) : (
                  'Hòa'
                )}
              </div>
              <div className="muted">{s.result.text}</div>
              <ScoreLine score={s.score} a={s.seats.w} b={s.seats.b} />
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
          {pending && !my && (
            <div className="muted small">
              {COLOR_NAME[pending.from]} đang {pending.type === 'draw' ? 'cầu hòa' : 'xin đi lại'}…
            </div>
          )}

          {my && (
            <div className="chess-actions">
              {s.status === 'waiting' && (
                <button className={`btn ${s.ready[my] ? '' : 'cta'}`} onClick={() => act({ type: 'ready' })} disabled={!s.seats[opp]}>
                  {s.ready[my] ? 'Hủy sẵn sàng' : <><Check size={16} aria-hidden /> Sẵn sàng</>}
                </button>
              )}
              {s.status === 'playing' && (
                <>
                  <button className="btn" disabled={!!pending} onClick={() => act({ type: 'requestUndo' })}>
                    <Undo2 size={16} aria-hidden /> Xin đi lại
                  </button>
                  <button className="btn" disabled={!!pending} onClick={() => act({ type: 'offerDraw' })}>
                    <Handshake size={16} aria-hidden /> Cầu hòa
                  </button>
                  <button className="btn danger" onClick={() => confirm('Bạn chắc chắn muốn xin thua?') && act({ type: 'resign' })}>
                    <Flag size={16} aria-hidden /> Xin thua
                  </button>
                </>
              )}
              {s.status === 'over' && (
                <button
                  className="btn primary"
                  disabled={s.rematch[my] || !s.seats[opp]}
                  onClick={() => act({ type: 'rematch' })}
                >
                  {s.rematch[my]
                    ? 'Đang chờ đối thủ…'
                    : s.rematch[opp]
                    ? <><RotateCcw size={16} aria-hidden /> Đồng ý chơi lại</>
                    : <><RotateCcw size={16} aria-hidden /> Chơi lại (đổi màu)</>}
                </button>
              )}
              {s.status !== 'playing' && (
                <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy xem</button>
              )}
            </div>
          )}
          {!my && <div className="muted small">Bạn đang xem. Ngồi vào ghế trống để chơi.</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn ghost sm" onClick={() => setManualFlip((f) => !f)}>
              <ArrowUpDown size={16} aria-hidden /> Lật bàn <kbd>F</kbd>
            </button>
          </div>
        </div>

        <Scoreboard
          room={room}
          score={s.score}
          playing={s.status === 'playing'}
          sides={{ w: { label: 'Trắng', cls: 'c-w' }, b: { label: 'Đen', cls: 'c-b' } }}
        />

        <MoveList moves={s.moves} />
        <div className="muted small">Thời gian: {s.options.minutes} phút mỗi bên. Hết giờ là thua.</div>
      </div>
    </div>
  );
}

function PlayerBar({ color, s, room, captured }: { color: ChessColor; s: ChessView; room: ClientRoom; captured: Captured }) {
  const { call, user } = useRoomApp();
  const my = s.myColor;
  const seat = s.seats[color];
  const running = s.running && s.turn === color;
  const ms = useCountdown(s.clocks[color], room.receivedAt, running);
  const low = ms < 60000;
  const member = seat && room.members.find((m) => m.id === seat.id);

  return (
    <div className={`chess-player ${running ? 'active' : ''}`}>
      <span className={`chess-chip ${color}`}>{color === 'w' ? '♔' : '♚'}</span>
      {seat ? (
        <div className="chess-pinfo">
          <div className="pname">
            <b>{seat.name}</b>{seat.id === user.id && ' (bạn)'}
            {s.score?.gameNo > 0 && (
              <span className="score-chip" title="Điểm trong phòng: thắng 1, hòa ½, thua 0">
                {fmtPts(pointsOf(s.score, seat.id) ?? 0)} điểm
              </span>
            )}
            {member && !member.online && <span className="muted"> (mất kết nối)</span>}
            {s.status === 'waiting' && s.ready[color] && <span className="ready"> ✔ sẵn sàng</span>}
            {s.status === 'over' && s.rematch[color] && <span className="ready"> ↻ muốn chơi lại</span>}
          </div>
          {/* Quân cờ đã ăn */}
          {captured && (captured.pieces.length > 0 || captured.lead > 0) && (
            <div className="chess-captured">
              {captured.pieces.map((t, idx) => (
                <span key={idx} className="cap-icon">
                  {color === 'w' ? UNICODE_BLACK[t] : UNICODE_WHITE[t]}
                </span>
              ))}
              {captured.lead > 0 && <span className="cap-lead">+{captured.lead}</span>}
            </div>
          )}
        </div>
      ) : (
        <span className="pname muted">
          Ghế trống {!my && s.status !== 'playing' && (
            <button className="btn primary sm" onClick={() => call('room:sit', { seat: color })}>
              Ngồi {COLOR_NAME[color]}
            </button>
          )}
        </span>
      )}
      <span className={`clock ${running ? 'running' : ''} ${low && running ? 'low' : ''}`}>
        {fmtClock(ms)}
      </span>
    </div>
  );
}

function MoveList({ moves }: { moves: ChessView['moves'] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [moves.length]);

  const rows: [number, ChessMoveView | undefined, ChessMoveView | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push([i / 2 + 1, moves[i], moves[i + 1]]);
  }

  return (
    <div className="panel moves">
      <h4>Biên bản ({moves.length} nước)</h4>
      <div className="move-list" ref={ref}>
        {rows.length === 0 && <div className="muted small">Chưa có nước đi</div>}
        {rows.map(([n, a, b]) => (
          <div key={n} className="move-row">
            <span className="muted">{n}.</span>
            <span className="c-w">{a?.san}</span>
            <span className="c-b">{b?.san || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoordinateLabels({ flipped }: { flipped: boolean }) {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
  const displayFiles = flipped ? files.slice().reverse() : files;
  const displayRanks = flipped ? ranks.slice().reverse() : ranks;

  return (
    <g className="chess-coords" aria-hidden>
      {/* Cột a-h ở cạnh dưới và trên */}
      {displayFiles.map((f, i) => (
        <g key={`f-${f}`}>
          <text x={PAD + i * CELL + CELL / 2} y={PAD - 7} textAnchor="middle">{f}</text>
          <text x={PAD + i * CELL + CELL / 2} y={SIZE - 6} textAnchor="middle">{f}</text>
        </g>
      ))}
      {/* Hàng 1-8 ở cạnh trái và phải */}
      {displayRanks.map((r, i) => (
        <g key={`r-${r}`}>
          <text x={PAD - 8} y={PAD + i * CELL + CELL / 2 + 4} textAnchor="middle">{r}</text>
          <text x={SIZE - 8} y={PAD + i * CELL + CELL / 2 + 4} textAnchor="middle">{r}</text>
        </g>
      ))}
    </g>
  );
}

function BoardDefs() {
  return (
    <defs>
      {/* Ô sáng kem */}
      <linearGradient id="chess-light" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f3e5c8" />
        <stop offset="100%" stopColor="#ebd7b2" />
      </linearGradient>
      {/* Ô tối gỗ hồ đào */}
      <linearGradient id="chess-dark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#b88b4a" />
        <stop offset="100%" stopColor="#9e7235" />
      </linearGradient>
      {/* Khung viền gỗ sẫm */}
      <linearGradient id="chess-frame" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#3d2716" />
        <stop offset="100%" stopColor="#22150a" />
      </linearGradient>
    </defs>
  );
}

const UNICODE_WHITE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const UNICODE_BLACK: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };

/** Component vẽ quân cờ sắc nét với SVG */
function ChessPiece({ piece, size = 44 }: { piece: string; size?: number }) {
  const color = colorOf(piece);
  const type = typeOf(piece);
  const isWhite = color === 'w';

  // Dùng SVG vector shapes phong cách Staunton
  return (
    <g
      className={`piece-svg ${color}`}
      filter="drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.45))"
    >
      {renderPieceShape(type, isWhite, size)}
    </g>
  );
}

function renderPieceShape(type: string | null, isWhite: boolean, size: number) {
  const s = size / 45; // Tỉ lệ theo chuẩn viewbox 45x45
  const fill = isWhite ? '#ffffff' : '#1f2937';
  const stroke = isWhite ? '#1e293b' : '#f8fafc';
  const strokeWidth = 1.4;

  return (
    <g transform={`scale(${s}) translate(-22.5, -22.5)`} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill={fill}>
      {type === 'P' && (
        <path d="M 22.5,9 A 4,4 0 1,1 22.4,9 Z M 22.5,13 C 20,13 18,17 19,21 C 20,24 16,32 15,35 L 30,35 C 29,32 25,24 26,21 C 27,17 25,13 22.5,13 Z M 13,38 L 32,38 L 32,41 L 13,41 Z" />
      )}
      {type === 'R' && (
        <g>
          <path d="M 12,38 L 33,38 L 33,41 L 12,41 Z M 14,35 L 31,35 L 30,22 L 15,22 Z" />
          <path d="M 13,16 L 13,22 L 32,22 L 32,16 L 29,16 L 29,19 L 26,19 L 26,16 L 19,16 L 19,19 L 16,19 L 16,16 Z" />
          <path d="M 11,14 L 34,14 L 34,16 L 11,16 Z" />
        </g>
      )}
      {type === 'N' && (
        <path d="M 22,10 C 25,11 27,13 27,15 C 27,18 24,19 22,18 C 22,18 23,20 25,21 C 27,22 30,21 31,23 C 33,26 31,32 29,35 L 32,38 L 13,38 C 13,35 15,32 16,28 C 17,25 15,24 13,22 C 11,20 12,16 14,14 C 16,12 18,10 22,10 Z M 24.5,14 A 1.5,1.5 0 1,1 24.4,14 Z" />
      )}
      {type === 'B' && (
        <g>
          <path d="M 22.5,7 A 2,2 0 1,1 22.4,7 Z" />
          <path d="M 17,35 L 28,35 C 29,32 30,25 29,20 C 27.5,14 24,10 22.5,10 C 21,10 17.5,14 16,20 C 15,25 16,32 17,35 Z" />
          <path d="M 13,38 L 32,38 L 32,41 L 13,41 Z" />
          <path d="M 20,18 L 25,22 M 25,18 L 20,22" />
        </g>
      )}
      {type === 'Q' && (
        <g>
          <circle cx="10" cy="14" r="2" />
          <circle cx="16" cy="11" r="2" />
          <circle cx="22.5" cy="9.5" r="2" />
          <circle cx="29" cy="11" r="2" />
          <circle cx="35" cy="14" r="2" />
          <path d="M 11,17 L 13,32 L 32,32 L 34,17 L 28,24 L 22.5,14 L 17,24 Z" />
          <path d="M 11,35 L 34,35 L 33,38 L 12,38 Z M 10,38 L 35,38 L 35,41 L 10,41 Z" />
        </g>
      )}
      {type === 'K' && (
        <g>
          {/* Cây thánh giá trên vương miện */}
          <path d="M 22.5,6 L 22.5,12 M 19.5,8.5 L 25.5,8.5" strokeWidth="1.8" />
          <path d="M 14,15 C 16,13 18,13 22.5,13 C 27,13 29,13 31,15 C 33,18 33,26 31,31 L 14,31 C 12,26 12,18 14,15 Z" />
          <path d="M 12,34 L 33,34 L 32,38 L 13,38 Z M 11,38 L 34,38 L 34,41 L 11,41 Z" />
          <circle cx="22.5" cy="20" r="2.5" />
        </g>
      )}
    </g>
  );
}
