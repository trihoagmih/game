import { useEffect, useMemo, useState } from 'react';
import { rankOf } from '@game/shared/cards';
import { isMeld, bestArrangement } from '@game/shared/tala';
import { useApp } from '../store.jsx';
import Card from '../components/Card.jsx';
import { useCountdown, useHotkeys } from '../hooks.js';

const POSITIONS = { 1: ['bottom'], 2: ['bottom', 'top'], 3: ['bottom', 'right', 'left'], 4: ['bottom', 'right', 'top', 'left'] };
const PHASE_VI = { draw: 'Bốc hoặc ăn bài', discard: 'Đánh bài', lay: 'Hạ phỏm / gửi bài rồi đánh lá cuối', done: 'Kết thúc' };
const fmt = (n) => (n > 0 ? '+' : '') + Number(n || 0).toLocaleString('vi-VN');

const sortCards = (cards, mode) => cards.slice().sort((a, b) => (mode === 'suit'
  ? a[1].localeCompare(b[1]) || rankOf(a) - rankOf(b)
  : rankOf(a) - rankOf(b) || a[1].localeCompare(b[1])));

export default function TalaGame({ room, state: s }) {
  const { act, call } = useApp();
  const g = s.game;
  const inGame = g && g.me >= 0;
  const timeLeft = useCountdown(s.turnLeft, room.receivedAt, !!s.turnLeft);

  if (!g || (!s.playing && !g.result)) return <Waiting s={s} act={act} call={call} />;

  return (
    <div className="tl">
      <Table s={s} g={g} act={act} timeLeft={timeLeft} inGame={inGame} />
      {g.result && <Result s={s} g={g} act={act} call={call} />}
    </div>
  );
}

function Waiting({ s, act, call }) {
  const seated = s.seats.filter(Boolean).length;
  useHotkeys({ n: () => s.mySeat >= 0 && seated >= 2 && act({ type: 'start' }) });
  return (
    <div className="tl-wait panel">
      <h3>Bàn Tá lả — cược {s.config.unit}/đơn vị</h3>
      <div className="tl-seats">
        {s.seats.map((seat, i) => (
          <div key={i} className={`tl-seat-box ${seat ? '' : 'empty'}`}>
            {seat ? (
              <>
                <b>{seat.name}</b>
                <div className={seat.total >= 0 ? 'pos' : 'neg'}>{fmt(seat.total)}</div>
              </>
            ) : s.mySeat < 0 ? (
              <button className="btn sm" onClick={() => call('room:sit', { seat: i })}>Ngồi đây</button>
            ) : <span className="muted">Trống</span>}
          </div>
        ))}
      </div>
      <div className="row">
        {s.mySeat >= 0 ? (
          <>
            <button className="btn primary" disabled={seated < 2} onClick={() => act({ type: 'start' })}><kbd>N</kbd> Bắt đầu ván</button>
            <button className="btn ghost" onClick={() => call('room:stand')}>Đứng dậy xem</button>
          </>
        ) : <span className="muted">Bạn đang xem. Chọn ghế trống để chơi.</span>}
      </div>
      {seated < 2 && <div className="muted small">Cần ít nhất 2 người để bắt đầu.</div>}
      <Rules />
    </div>
  );
}

function Rules() {
  return (
    <details className="rules">
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

function Table({ s, g, act, timeLeft, inGame }) {
  const { toast } = useApp();
  const n = g.players.length;
  const base = g.me >= 0 ? g.me : 0;
  const pos = POSITIONS[n];
  const me = inGame ? g.players[g.me] : null;
  const myTurn = inGame && g.turn === g.me;

  // ----- Bài trên tay, thứ tự & lựa chọn -----
  const hand = me?.hand || [];
  const [sortMode, setSortMode] = useState('rank');
  const [order, setOrder] = useState([]);
  const [selected, setSelected] = useState([]);
  const [cursor, setCursor] = useState(0);
  const handKey = hand.slice().sort().join(',');
  useEffect(() => {
    setOrder((prev) => {
      const kept = prev.filter((c) => hand.includes(c));
      const added = hand.filter((c) => !kept.includes(c));
      return kept.length === 0 ? sortCards(hand, sortMode) : [...kept, ...added];
    });
    setSelected((sel) => sel.filter((c) => hand.includes(c)));
  }, [handKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const ordered = order.filter((c) => hand.includes(c));
  useEffect(() => { if (cursor >= ordered.length) setCursor(Math.max(0, ordered.length - 1)); }, [ordered.length, cursor]);

  const eaten = new Set(me?.eaten || []);
  const hint = useMemo(() => {
    if (!hand.length) return new Set();
    const b = bestArrangement(hand, me?.eaten || []);
    return new Set(b ? b.melds.flat() : []);
  }, [handKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (c) => setSelected((sel) => (sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]));
  const target = selected.length === 1 ? selected[0] : selected.length === 0 ? ordered[cursor] : null;

  const doDraw = () => myTurn && g.phase === 'draw' && act({ type: 'draw' });
  const doEat = () => myTurn && g.canEat && act({ type: 'eat' });
  const doDiscard = () => myTurn && (g.phase === 'discard' || g.phase === 'lay') && target && act({ type: 'discard', card: target }).then((r) => r && setSelected([]));
  const doLay = () => myTurn && g.phase === 'lay' && selected.length >= 3 && act({ type: 'lay', cards: selected }).then((r) => r && setSelected([]));
  const doAutoLay = () => myTurn && g.phase === 'lay' && act({ type: 'autoLay' });
  const sendTargets = (card) => {
    const res = [];
    g.players.forEach((p, t) => p.melds.forEach((m, k) => { if (isMeld([...m.cards, card])) res.push({ target: t, meldIdx: k }); }));
    return res;
  };
  const doSend = (t) => {
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
    Escape: () => setSelected([]),
    ArrowLeft: () => setCursor((c) => Math.max(0, c - 1)),
    ArrowRight: () => setCursor((c) => Math.min(ordered.length - 1, c + 1)),
    ArrowUp: () => ordered[cursor] && toggle(ordered[cursor]),
    ArrowDown: () => ordered[cursor] && setSelected((sel) => sel.filter((x) => x !== ordered[cursor])),
  }, inGame && !g.result);

  const canSendTo = (t, k) => myTurn && g.phase === 'lay' && target && isMeld([...g.players[t].melds[k].cards, target]) && me.melds.length > 0;

  return (
    <div className={`tl-table n${n}`}>
      {g.players.map((p, i) => {
        const k = (i - base + n) % n;
        const position = pos[k];
        const isTurn = g.turn === i;
        const seat = s.seats[s.gameSeats[i]];
        const isMe = i === g.me;
        return (
          <div key={p.id} className={`tl-player pos-${position} ${isTurn ? 'turn' : ''}`}>
            <div className="tl-head">
              <b>{p.name}</b>{isMe && ' (bạn)'}
              {i === g.first && <span className="badge">Đi đầu</span>}
              {seat?.left && <span className="badge warn">Đã rời</span>}
              {seat && !seat.online && !seat.left && <span className="badge warn">Mất kết nối</span>}
              <span className={`tl-score ${p.score >= 0 ? 'pos' : 'neg'}`}>{fmt(p.score)}</span>
              {isTurn && !g.result && <span className="tl-timer">⏱ {Math.ceil(timeLeft / 1000)}s</span>}
            </div>
            {!isMe && (
              <div className="tl-hand-back">
                {p.hand ? p.hand.map((c) => <Card key={c} card={c} size="sm" />) : Array.from({ length: p.handCount }).map((_, j) => <Card key={j} card="??" size="xs" />)}
                {!p.hand && <span className="muted small"> {p.handCount} lá</span>}
              </div>
            )}
            {p.eaten.length > 0 && !p.finished && (
              <div className="tl-row"><span className="tl-lbl">Đã ăn</span>{p.eaten.map((c) => <Card key={c} card={c} size="sm" locked />)}</div>
            )}
            <div className="tl-row">
              <span className="tl-lbl">Đánh ({p.discardCount}/4)</span>
              {p.discards.map((c) => (
                <Card key={c} card={c} size="sm" highlight={g.lastDiscard?.card === c} />
              ))}
            </div>
            {p.melds.length > 0 && (
              <div className="tl-row melds">
                <span className="tl-lbl">Phỏm</span>
                {p.melds.map((m, kk) => (
                  <div key={kk} className={`meld ${canSendTo(i, kk) ? 'sendable' : ''}`}
                    onClick={() => canSendTo(i, kk) && doSend({ target: i, meldIdx: kk })}
                    title={canSendTo(i, kk) ? 'Click để gửi lá đang chọn vào phỏm này' : ''}>
                    {m.cards.map((c) => <Card key={c} card={c} size="sm" />)}
                  </div>
                ))}
              </div>
            )}
            {p.finished && p.melds.length === 0 && <div className="mom">MÓM</div>}
          </div>
        );
      })}

      <div className="tl-center">
        <div className={`deck ${myTurn && g.phase === 'draw' ? 'can' : ''}`} onClick={doDraw} title="Bốc bài (D)">
          <Card card="??" size="md" />
          <span className="deck-count">{g.deckCount}</span>
        </div>
        {!g.result && (
          <div className="tl-status">
            {g.turn >= 0 && <>Lượt: <b>{g.players[g.turn].name}</b> — {PHASE_VI[g.phase]}</>}
          </div>
        )}
        <div className="tl-log">
          {g.log.slice(-4).map((l, i) => <div key={i} className="small muted">{l}</div>)}
        </div>
      </div>

      {inGame && (
        <div className="tl-me">
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
                  <button className="btn" disabled={!target || !me.melds.length} onClick={() => doSend()}><kbd>G</kbd> Gửi</button>
                </>
              )}
              {g.canU && <button className="btn warn pulse" onClick={doU}><kbd>U</kbd> Ù!</button>}
              <button className="btn ghost sm" onClick={doSort}><kbd>S</kbd> Xếp theo {sortMode === 'rank' ? 'chất' : 'số'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Result({ s, g, act, call }) {
  const r = g.result;
  const rankName = ['Nhất', 'Nhì', 'Ba', 'Bét'];
  useHotkeys({ n: () => s.mySeat >= 0 && act({ type: 'start' }) });
  return (
    <div className="tl-result panel">
      <h3>{r.type === 'u' ? `🎉 ${g.players[r.winner].name} Ù!` : `🏆 ${g.players[r.winner].name} về Nhất`}</h3>
      {r.type === 'u' && r.den !== null && r.den !== undefined && <div className="muted">{g.players[r.den].name} đền làng</div>}
      <table className="result-table">
        <thead><tr><th>Hạng</th><th>Người chơi</th><th>Điểm bài</th><th>Thắng/thua</th></tr></thead>
        <tbody>
          {r.ranking.map((p, k) => (
            <tr key={p}>
              <td>{r.type === 'u' ? (k === 0 ? 'Ù' : '—') : r.mom[p] ? 'Móm' : rankName[k]}</td>
              <td>{g.players[p].name}</td>
              <td>{r.points[p]}</td>
              <td className={r.scores[p] >= 0 ? 'pos' : 'neg'}>{fmt(r.scores[p] * s.config.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        {s.mySeat >= 0 ? (
          <>
            <button className="btn primary" disabled={s.seats.filter(Boolean).length < 2} onClick={() => act({ type: 'start' })}><kbd>N</kbd> Ván mới</button>
            <button className="btn ghost" onClick={() => call('room:stand')}>Đứng dậy xem</button>
          </>
        ) : (
          s.seats.some((x) => !x) && <span className="muted">Có ghế trống — </span>
        )}
        {s.mySeat < 0 && s.seats.map((x, i) => !x && (
          <button key={i} className="btn sm" onClick={() => call('room:sit', { seat: i })}>Ngồi ghế {i + 1}</button>
        ))}
      </div>
      <div className="small muted">Tổng điểm: {s.seats.filter(Boolean).map((x) => `${x.name}: ${fmt(x.total)}`).join(' · ')}</div>
    </div>
  );
}
