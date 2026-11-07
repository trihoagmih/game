import { useEffect, useMemo, useState } from 'react';
import { rankOf } from '@game/shared/cards';
import { isMeld, bestArrangement, sortByMeld } from '@game/shared/tala';
import { useApp } from '../store.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { TalaGameView, TalaView } from '@game/shared/views';
import Card from '../components/Card.js';
import CardTable from '../components/CardTable.js';
import GameInfo from '../components/GameInfo.js';
import { ResultOverlay } from '../components/BoardRequests.js';
import { WaitingRoom, NextGameActions, WaitingSeats } from '../components/CardTableParts.js';
import { fmtSigned } from '../format.js';
import { Timer, ArrowDownUp } from 'lucide-react';
import { useCountdown, useHotkeys } from '../hooks.js';
import './TalaGame.css';

type Act = AppContextValue['act'];
type SendTarget = { target: number; meldIdx: number };

const PHASE_VI: Record<string, string> = { draw: 'Bốc hoặc ăn bài', discard: 'Đánh bài', lay: 'Hạ phỏm / gửi bài rồi đánh lá cuối', done: 'Kết thúc' };

const sortCards = (cards: string[], mode: string) => cards.slice().sort((a, b) => (mode === 'suit'
  ? a[1].localeCompare(b[1]) || rankOf(a) - rankOf(b)
  : rankOf(a) - rankOf(b) || a[1].localeCompare(b[1])));

function PlayerAvatar({ index }: { index: number }) {
  const colors = ['#fdba74', '#c4b5fd', '#86efac', '#93c5fd'];
  const color = colors[index % colors.length];
  return (
    <span className="tl-avatar-frame" aria-hidden="true">
    <svg className="tl-avatar" viewBox="0 0 80 112">
      <ellipse cx="40" cy="105" rx="27" ry="5" fill="#000" opacity=".18" />
      <g stroke="#253247" strokeWidth="2" strokeLinejoin="round">
        <path d="M29 84v16h10l2-16m2 0v16h10V84" fill="#334155" />
        <path d="M28 99q-8 8 1 8h11v-8m3 0v8h13q6-5-4-8" fill="#fff7ed" />
        <path d="M26 61q-12 4-13 20l8 3 10-16m22-7q13 4 14 20l-8 3-10-16" fill={color} />
        <path d="M14 80q-5 8 2 10 6 1 6-7m37 0q0 8 6 7 7-2 1-10" fill="#ffdbbd" />
        <path d="M28 59q12-7 24 0l5 29q-17 6-34 0Z" fill={color} />
        <path d="m33 62 7 8 7-8" fill="#fff7ed" />
        <path d="M32 77h16v8H32Z" fill="#fff7ed" opacity=".65" />
        <path d="M13 35 14 7 31 17q10-5 20 0L67 7l1 29" fill={color} />
        <path d="m19 21-1-7 8 7m30 0 7-7-1 8" fill="#fda4af" stroke="none" />
        <ellipse cx="40" cy="36" rx="30" ry="28" fill={color} />
        <ellipse cx="40" cy="40" rx="24" ry="22" fill="#ffdbbd" />
        <path d="M17 35q0-22 23-22 24 0 24 22L52 24l-4 10-11-10-10 12-1-8Z" fill={['#713f2a', '#433049', '#374151', '#775036'][index % 4]} stroke="none" />
        <ellipse cx="30" cy="42" rx="3.5" ry="5" fill="#253247" stroke="none" />
        <ellipse cx="50" cy="42" rx="3.5" ry="5" fill="#253247" stroke="none" />
        <path d="M29 40h1m19 0h1" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="23" cy="49" rx="5" ry="3" fill="#fb7185" opacity=".55" stroke="none" />
        <ellipse cx="57" cy="49" rx="5" ry="3" fill="#fb7185" opacity=".55" stroke="none" />
        <path d="M35 51q5 7 10 0" fill="#fb7185" strokeLinecap="round" />
      </g>
    </svg>
    </span>
  );
}

export default function TalaGame({ room, state: s }: { room: ClientRoom; state: TalaView }) {
  const { act } = useApp();
  const g = s.game;
  const inGame = !!g && g.me >= 0;
  const timeLeft = useCountdown(s.turnLeft, room.receivedAt, !!s.turnLeft);

  if (!g || (!s.playing && !g.result)) return <WaitingRoom s={s} title="Bàn Tá lả" startLabel="Bắt đầu ván" rules={<Rules />} />;

  return (
    <div className="tl">
      <Table s={s} g={g} act={act} timeLeft={timeLeft} inGame={inGame} />
      {!g.result && <WaitingSeats s={s} />}
      {g.result && <Result s={s} g={g} />}
      <GameInfo><div className="panel"><Rules open /></div></GameInfo>
    </div>
  );
}

function Rules({ open = false }: { open?: boolean }) {
  return (
    <details className="rules" open={open}>
      <summary>Luật chơi tóm tắt</summary>
      <ul>
        <li>Người đi đầu 10 lá, còn lại 9 lá. Mỗi lượt <b>bốc</b> 1 lá hoặc <b>ăn</b> lá người trước vừa đánh (nếu tạo phỏm), rồi <b>đánh</b> 1 lá.</li>
        <li>Phỏm: ≥3 lá cùng số, hoặc ≥3 lá liên tiếp cùng chất (A nhỏ nhất, không có Q-K-A).</li>
        <li>Lá đã ăn phải nằm trong phỏm, không được đánh đi; hai lá ăn không được chung một phỏm.</li>
        <li>Mỗi người đánh 4 lượt. Lượt thứ 4: hạ phỏm, gửi lá vào phỏm đã hạ, rồi đánh lá cuối.</li>
        <li>Điểm = tổng lá còn lại (A=1, J=11, Q=12, K=13). Ít điểm nhất là Nhất. Không có phỏm = Móm.</li>
        <li>Nhì trả 1, Ba trả 2, Bét trả 3, Móm trả 4 đơn vị. Bị ăn mất 1, bị ăn chốt mất 4. Ù: mỗi nhà trả 5 (ù sau khi ăn thì người bị ăn đền cả làng).</li>
      </ul>
    </details>
  );
}

function Table({ s, g, act, timeLeft, inGame }: { s: TalaView; g: TalaGameView; act: Act; timeLeft: number; inGame: boolean }) {
  const { toast } = useApp();
  const n = g.players.length;
  const base = g.me >= 0 ? g.me : 0;
  const me = inGame ? g.players[g.me] : null;
  const myTurn = inGame && g.turn === g.me;

  // ----- Bài trên tay, thứ tự & lựa chọn -----
  const hand = me?.hand || [];
  const [sortMode, setSortMode] = useState('rank');
  const [order, setOrder] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const handKey = hand.slice().sort().join(',');
  useEffect(() => {
    setOrder((prev) => {
      const kept = prev.filter((c) => hand.includes(c));
      const added = hand.filter((c) => !kept.includes(c));
      return kept.length === 0 ? sortCards(hand, sortMode) : [...kept, ...added];
    });
    setSelected((sel) => sel.filter((c) => hand.includes(c)));
  }, [handKey]);
  const ordered = order.filter((c) => hand.includes(c));
  useEffect(() => { if (cursor >= ordered.length) setCursor(Math.max(0, ordered.length - 1)); }, [ordered.length, cursor]);

  const eaten = new Set(me?.eaten || []);
  const hint = useMemo(() => {
    if (!hand.length) return new Set<string>();
    const b = bestArrangement(hand, me?.eaten || []);
    return new Set(b ? b.melds.flat() : []);
  }, [handKey]);

  const toggle = (c: string) => setSelected((sel) => (sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]));
  const target = selected.length === 1 ? selected[0] : selected.length === 0 ? ordered[cursor] : null;

  const doDraw = () => myTurn && g.phase === 'draw' && act({ type: 'draw' });
  const doEat = () => myTurn && g.canEat && act({ type: 'eat' });
  const doDiscard = () => myTurn && (g.phase === 'discard' || g.phase === 'lay') && target && act({ type: 'discard', card: target }).then((r) => r && setSelected([]));
  const doLay = () => myTurn && g.phase === 'lay' && selected.length >= 3 && act({ type: 'lay', cards: selected }).then((r) => r && setSelected([]));
  const doAutoLay = () => myTurn && g.phase === 'lay' && act({ type: 'autoLay' });
  const sendTargets = (card: string) => {
    const res: SendTarget[] = [];
    g.players.forEach((p, t) => p.melds.forEach((m, k) => { if (isMeld([...m.cards, card])) res.push({ target: t, meldIdx: k }); }));
    return res;
  };
  const doSend = (t?: SendTarget) => {
    if (!myTurn || g.phase !== 'lay' || !target) return;
    const dest = t || sendTargets(target)[0];
    if (!dest) return toast('Lá này không gửi được vào phỏm nào', 'error');
    act({ type: 'send', card: target, ...dest }).then((r) => r && setSelected([]));
  };
  const doU = () => g.canU && act({ type: 'u' });
  const doSort = () => {
    const m = sortMode === 'rank' ? 'suit' : 'rank';
    setSortMode(m);
    setOrder(sortCards(hand, m));
  };
  const doSortMeld = () => {
    setOrder(sortByMeld(hand, me?.eaten || []));
    setCursor(0);
  };

  useHotkeys({
    d: doDraw,
    ' ': () => (myTurn && g.phase === 'draw' ? doDraw() : ordered[cursor] && toggle(ordered[cursor])),
    e: doEat,
    Enter: doDiscard,
    h: doLay,
    x: doAutoLay,
    g: () => doSend(),
    u: doU,
    s: doSort,
    p: doSortMeld,
    Escape: () => setSelected([]),
    ArrowLeft: () => setCursor((c) => Math.max(0, c - 1)),
    ArrowRight: () => setCursor((c) => Math.min(ordered.length - 1, c + 1)),
    ArrowUp: () => ordered[cursor] && toggle(ordered[cursor]),
    ArrowDown: () => ordered[cursor] && setSelected((sel) => sel.filter((x) => x !== ordered[cursor])),
  }, inGame && !g.result);

  const canSendTo = (t: number, k: number) => myTurn && g.phase === 'lay' && target && isMeld([...g.players[t].melds[k].cards, target]) && !!me?.melds.length;

  const seats = g.players.map((p, i) => {
    const isTurn = g.turn === i && !g.result;
    const seat = s.seats[s.gameSeats[i]];
    const isMe = i === g.me;
    return {
      key: p.id,
      rel: (i - base + n) % n,
      me: isMe,
      active: isTurn,
      node: (
        <div className={`tl-player ${isTurn ? 'turn' : ''} ${!isMe && p.eaten.length > 0 && !p.finished ? 'has-eaten' : ''}`}>
          <div className="tl-head">
            <PlayerAvatar index={i} />
            <b className="seat-name">{p.name}</b>{isMe && <span className="seat-me">bạn</span>}
            {i === g.first && <span className="badge">Đi đầu</span>}
            {seat?.left && <span className="badge warn">Đã rời</span>}
            {seat && !seat.online && !seat.left && <span className="badge warn">Mất kết nối</span>}
            <span className={`tl-score ${p.score >= 0 ? 'pos' : 'neg'}`}>{fmtSigned(p.score)}</span>
            {/* Đồng hồ luôn giữ chỗ (ẩn khi không tới lượt) → dòng tên không đổi chiều cao */}
            <span className={`tl-timer ${isTurn ? '' : 'off'}`} aria-hidden={!isTurn}><Timer size={13} aria-hidden /> {isTurn ? Math.ceil(timeLeft / 1000) : 0}s</span>
          </div>
          {!isMe && (
            <div className="tl-hand-back">
              {p.hand ? p.hand.map((c) => <Card key={c} card={c} size="sm" />)
                : <span className="card-fan" aria-label={`${p.handCount} lá`}>{Array.from({ length: p.handCount }).map((_, j) => <Card key={j} card="??" size="xs" />)}</span>}
              {!p.hand && <span className="felt-muted small">{p.handCount} lá</span>}
            </div>
          )}
          {!isMe && p.eaten.length > 0 && !p.finished && (
            <div className="tl-eaten-side" aria-label={`Bài đã ăn của ${p.name}`}>
              <span className="tl-lbl">Đã ăn</span>
              <div className="tl-eaten-cards">{p.eaten.map((c) => <Card key={c} card={c} size="sm" locked />)}</div>
            </div>
          )}
          <div className="tl-row">
            <span className="tl-lbl">Đánh {p.discardCount}/4</span>
            {p.discards.map((c) => (
              <Card key={c} card={c} size="sm" highlight={g.lastDiscard?.card === c} />
            ))}
          </div>
          {p.finished && p.melds.length === 0 && <div className="mom">MÓM</div>}
        </div>
      ),
    };
  });

  const laidMelds = g.players.some((p) => p.melds.length > 0) ? (
    <section className="tl-laid" aria-label="Phỏm đã hạ trên bàn">
      <h3>Phỏm đã hạ</h3>
      <div className="tl-laid-players">
        {g.players.map((p, i) => p.melds.length > 0 && (
          <div className="tl-laid-player" key={p.id}>
            <div className="tl-laid-name"><b>{p.name}</b>{i === g.me && <span className="seat-me">bạn</span>}</div>
            <div className="tl-laid-melds">
              {p.melds.map((m, k) => {
                const sendable = !!canSendTo(i, k);
                return (
                  <button type="button" key={k} className={`meld ${sendable ? 'sendable' : ''}`}
                    disabled={!sendable} onClick={() => doSend({ target: i, meldIdx: k })}
                    aria-label={`Phỏm ${k + 1} của ${p.name}${sendable ? ': gửi lá đang chọn' : ''}`}
                    title={sendable ? 'Bấm để gửi lá đang chọn vào phỏm này' : `Phỏm đã hạ của ${p.name}`}>
                    {m.cards.map((c) => <Card key={c} card={c} size="sm" />)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  ) : null;

  const center = (
    <>
      <button type="button" className={`deck ${myTurn && g.phase === 'draw' ? 'can' : ''}`} onClick={doDraw}
        disabled={!(myTurn && g.phase === 'draw')} aria-label={`Bốc bài (còn ${g.deckCount} lá)`} title="Bốc bài (D)">
        <Card card="??" size="md" />
        <span className="deck-count">{g.deckCount}</span>
      </button>
      {!g.result && (
        <div className="tl-status" role="status" aria-live="polite">
          {g.turn >= 0 && <>Lượt: <b>{g.players[g.turn].name}</b> — {PHASE_VI[g.phase]}</>}
        </div>
      )}
      <div className="tl-log">
        {g.log.slice(-3).map((l, i) => <div key={i} className="small felt-muted">{l}</div>)}
      </div>
    </>
  );

  return (
    <div className="tl-board">
      <CardTable seats={seats} center={center} tableContent={laidMelds} outsideSeats className="ct-tala" />
      {inGame && (
        <div className={`ct-hand-panel ${myTurn ? 'turn' : ''}`}>
          <div className="tl-hand">
            {/* Vạch xanh dưới lá = lá có thể tạo phỏm (gắn vào từng lá để xuống dòng cùng nhau trên màn nhỏ) */}
            {ordered.map((c, i) => (
              <span key={c} className={`tl-card ${hint.has(c) ? 'hint' : ''}`}>
                <Card card={c} size="lg"
                  selected={selected.includes(c)}
                  focused={i === cursor}
                  locked={eaten.has(c)}
                  dim={false}
                  title={eaten.has(c) ? 'Lá đã ăn — phải nằm trong phỏm' : hint.has(c) ? 'Có thể tạo phỏm' : ''}
                  onClick={() => { setCursor(i); toggle(c); }} />
              </span>
            ))}
          </div>
          {!g.result && (
            <div className="row wrap tl-actions">
              {myTurn ? <span className="your-turn">Tới lượt bạn: {PHASE_VI[g.phase]}</span> : <span className="muted">Chờ tới lượt…</span>}
              <button className="btn primary" disabled={!myTurn || g.phase !== 'draw'} onClick={doDraw}><kbd>D</kbd> Bốc</button>
              <button className="btn primary" disabled={!g.canEat} onClick={doEat}><kbd>E</kbd> Ăn</button>
              <button className="btn" disabled={!myTurn || g.phase === 'draw' || !target} onClick={doDiscard}><kbd>Enter</kbd> Đánh</button>
              {g.phase === 'lay' && myTurn && (
                <>
                  <button className="btn" disabled={selected.length < 3} onClick={doLay}><kbd>H</kbd> Hạ phỏm</button>
                  <button className="btn" onClick={doAutoLay}><kbd>X</kbd> Hạ tự động</button>
                  <button className="btn" disabled={!target || !me?.melds.length} onClick={() => doSend()}><kbd>G</kbd> Gửi</button>
                </>
              )}
              {g.canU && <button className="btn cta" onClick={doU}><kbd>U</kbd> Ù!</button>}
              <button className="btn ghost sm" onClick={doSort}><ArrowDownUp size={14} aria-hidden /> <kbd>S</kbd> Xếp theo {sortMode === 'rank' ? 'chất' : 'số'}</button>
              <button className="btn ghost sm" onClick={doSortMeld} title="Gom phỏm lên trước, bài rác ra sau (P)"><ArrowDownUp size={14} aria-hidden /> <kbd>P</kbd> Xếp theo phỏm</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Result({ s, g }: { s: TalaView; g: TalaGameView }) {
  const r = g.result;
  if (!r) return null;
  const rankName = ['Nhất', 'Nhì', 'Ba', 'Bét'];
  return (
    <ResultOverlay over peek="Xem bàn" resetKey={s.gameNo} title={r.type === 'u' ? `${g.players[r.winner].name} Ù!` : `${g.players[r.winner].name} về Nhất`}
      detail={r.type === 'u' && r.den !== null && r.den !== undefined ? `${g.players[r.den].name} đền làng` : null}>
    <div className="tl-result">
      <table className="result-table">
        <thead><tr><th>Hạng</th><th>Người chơi</th><th>Điểm bài</th><th>Thắng/thua</th></tr></thead>
        <tbody>
          {r.ranking.map((p, k) => (
            <tr key={p}>
              <td>{r.type === 'u' ? (k === 0 ? 'Ù' : '—') : r.mom[p] ? 'Móm' : rankName[k]}</td>
              <td>{g.players[p].name}</td>
              <td>{r.points[p]}</td>
              <td className={r.scores[p] >= 0 ? 'pos' : 'neg'}>{fmtSigned(r.scores[p] * s.config.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <NextGameActions s={s} />
    </div>
    </ResultOverlay>
  );
}
