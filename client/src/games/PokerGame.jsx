import { useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useApp } from '../store.jsx';
import Card from '../components/Card.jsx';
import { useCountdown, useHotkeys } from '../hooks.js';
import PokerHandLog from './PokerHandLog.jsx';
import Modal from '../components/Modal.jsx';

const STREET_VI = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', done: 'Kết thúc' };
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN');

export default function PokerGame({ room, state: s }) {
  const { act, call, user } = useApp();
  const [editBlinds, setEditBlinds] = useState(false);
  const isOwner = room.ownerId === user.id;
  const h = s.hand;
  const N = s.seats.length;
  const mySeat = s.mySeat;
  const base = mySeat >= 0 ? mySeat : 0;
  const o = s.options;
  useHotkeys({ t: () => s.canRabbit && act({ type: 'rabbit' }) });
  const timeLeft = useCountdown(s.turnLeft, room.receivedAt, !!s.turnLeft);
  const nextIn = useCountdown(s.nextHandIn, room.receivedAt, !!s.nextHandIn);

  const winners = useMemo(() => {
    const w = new Set();
    h?.result?.pots.forEach((p) => p.winners.forEach((x) => w.add(x)));
    return w;
  }, [h?.result]);
  const winCards = useMemo(() => {
    const c = new Set();
    for (const w of winners) h?.result?.shown?.[w]?.best?.forEach((x) => c.add(x));
    return c;
  }, [winners, h?.result]);

  return (
    <div className={`pk ${mySeat >= 0 ? 'seated' : ''}`}>
      <div className="pk-table">
        <div className="pk-felt">
          <div className="pk-center">
            <div className="pk-board">
              {[0, 1, 2, 3, 4].map((i) => {
                if (h?.board[i]) return <Card key={i} card={h.board[i]} size="md" highlight={winCards.has(h.board[i])} />;
                const r = h?.rabbit?.[i - h.board.length];
                return r
                  ? <div key={i} className="rabbit-card" title="Rabbit hunt — bài lẽ ra sẽ ra"><Card card={r} size="md" /></div>
                  : s.canRabbit
                    ? <button key={i} className="card-slot rabbit-slot" title="Rabbit hunt (T): lật bài lẽ ra sẽ ra, không tính" onClick={() => act({ type: 'rabbit' })}>🐇</button>
                    : <div key={i} className="card-slot" />;
              })}
            </div>
            {h && <div className="pk-pot">Pot: <b>{fmt(h.pot)}</b> <span className="muted">· {STREET_VI[h.street]}</span>{h.rabbit && <span className="pk-rabbit-note" title="Các lá mờ là bài lẽ ra sẽ ra, không tính"> · 🐇 rabbit</span>}</div>}
            {h?.result && (
              <div className="pk-result">
                {h.result.pots.map((p, k) => (
                  <div key={k}>🏆 {p.winners.map((w) => s.seats[w]?.name || '?').join(', ')} thắng {fmt(p.amount)}{p.hand ? ` — ${p.hand}` : ''}</div>
                ))}
              </div>
            )}
            {!h?.street || h.street === 'done' ? (
              <div className="muted small pk-next">
                {nextIn ? `Ván mới sau ${Math.ceil(nextIn / 1000)} giây…` : s.seats.filter((x) => x && x.chips > 0 && !x.sitOut).length < 2 ? 'Đang chờ ít nhất 2 người chơi…' : ''}
              </div>
            ) : null}
            <div className="muted small">
              Blind {fmt(s.smallBlind)}/{fmt(s.bigBlind)}
              {isOwner && <button className="link pk-blind-edit" title="Đổi blind" aria-label="Đổi blind" onClick={() => setEditBlinds(true)}><Pencil size={14} aria-hidden /></button>}
            </div>
            {s.nextBlinds && <div className="pk-next-blinds small">Từ ván sau: {fmt(s.nextBlinds.smallBlind)}/{fmt(s.nextBlinds.bigBlind)}</div>}
          </div>

          {s.seats.map((seat, i) => {
            const k = (i - base + N) % N;
            const ang = Math.PI / 2 + (k * 2 * Math.PI) / N;
            const x = 50 + 44 * Math.cos(ang);
            const y = 50 + 40 * Math.sin(ang);
            const style = { left: `${x}%`, top: `${y}%` };
            if (!seat) {
              return (
                <div key={i} className="pk-seat empty" style={style}>
                  {mySeat < 0 ? <button className="btn sm" onClick={() => call('room:sit', { seat: i })}>Ngồi đây</button> : <span className="muted small">Trống</span>}
                </div>
              );
            }
            const toAct = h && h.toAct === i && h.street !== 'done';
            const shown = h?.result?.shown?.[i];
            return (
              <div key={i} className={`pk-seat ${toAct ? 'acting' : ''} ${seat.folded ? 'folded' : ''} ${winners.has(i) ? 'winner' : ''} ${i === mySeat ? 'me' : ''}`} style={style}>
                <div className="pk-cards">
                  {seat.hole && seat.hole.map((c, j) => <Card key={j} card={c} size={i === mySeat ? 'md' : 'sm'} highlight={winners.has(i) && winCards.has(c)} />)}
                </div>
                <div className="pk-info">
                  <div className="pk-name">
                    {seat.name}{seat.left && ' (rời)'}{seat.sitOut && ' (nghỉ)'}
                  </div>
                  <div className="pk-chips">💰 {fmt(seat.chips)}</div>
                  {seat.lastAction && <div className="pk-act">{seat.lastAction}</div>}
                  {shown && <div className="pk-hand">{shown.hand}</div>}
                  {toAct && <div className="timebar"><div style={{ width: `${(timeLeft / s.turnTotal) * 100}%` }} /></div>}
                </div>
                {h && h.street !== 'done' && h.dealer === i && <div className="pk-dealer">D</div>}
                {seat.bet > 0 && <div className="pk-bet">{fmt(seat.bet)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {mySeat >= 0 && (
        <ActionBar s={s} o={o} act={act} myTurn={!!o} timeLeft={timeLeft} />
      )}
      {mySeat >= 0 && (
        <div className="row pk-mybar">
          {s.seats[mySeat].chips < s.bigBlind && !(h && h.street !== 'done' && s.seats[mySeat].inHand) && (
            <button className="btn primary" onClick={() => act({ type: 'rebuy' })}>Nạp thêm {fmt(s.config.buyIn)} chip</button>
          )}
          <button className="btn ghost sm" onClick={() => act({ type: 'sitout' })}>{s.seats[mySeat].sitOut ? 'Quay lại chơi' : 'Nghỉ ván sau'}</button>
          <button className="btn ghost sm" onClick={() => call('room:stand')}>Đứng dậy xem</button>
        </div>
      )}
      {mySeat < 0 && <div className="muted center small">Bạn đang xem. Chọn "Ngồi đây" ở ghế trống để chơi.</div>}
      {h && (
        <details className="panel pk-log">
          <summary>Diễn biến ván #{h.no}</summary>
          {h.log.map((l, i) => <div key={i} className="small">{l}</div>)}
        </details>
      )}
      <PokerHandLog s={s} />
      {editBlinds && <BlindsDialog s={s} act={act} onClose={() => setEditBlinds(false)} />}
    </div>
  );
}

function ActionBar({ s, o, act, myTurn, timeLeft }) {
  const bb = s.bigBlind;
  const [amount, setAmount] = useState(o ? o.minTo : 0);
  const key = o ? `${s.hand?.no}:${o.currentBet}:${o.minTo}` : '';
  useEffect(() => { if (o) setAmount(o.minTo); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const canBR = o && (o.canBet || o.canRaise);
  const clamp = (v) => (o ? Math.max(o.minTo, Math.min(o.maxTo, Math.round(v))) : v);
  const preset = (f) => {
    if (!o) return;
    const toCall = o.currentBet - o.myBet;
    setAmount(clamp(o.currentBet + f * (o.pot + toCall)));
  };

  const doFold = () => o && act({ type: 'act', action: 'fold' });
  const doCall = () => o && act({ type: 'act', action: o.canCheck ? 'check' : 'call' });
  const doCheck = () => o && o.canCheck && act({ type: 'act', action: 'check' });
  const doBR = () => {
    if (!canBR) return;
    act({ type: 'act', action: amount >= o.maxTo ? 'allin' : o.canBet ? 'bet' : 'raise', amount });
  };
  const doAllIn = () => o && act({ type: 'act', action: 'allin' });

  useHotkeys({
    f: doFold,
    c: doCall,
    k: doCheck,
    b: doBR,
    r: doBR,
    a: doAllIn,
    Enter: doBR,
    ArrowUp: (e) => canBR && setAmount((v) => clamp(v + (e.shiftKey ? 10 : 1) * bb)),
    ArrowDown: (e) => canBR && setAmount((v) => clamp(v - (e.shiftKey ? 10 : 1) * bb)),
    1: () => preset(1 / 3),
    2: () => preset(1 / 2),
    3: () => preset(3 / 4),
    4: () => preset(1),
  }, myTurn);

  // Luôn giữ nguyên khung (nút + thanh chọn mức cược) kể cả khi chưa tới lượt → không nhảy layout
  return (
    <div className={`pk-actions ${o ? '' : 'idle'}`}>
      <div className="pk-turn">{o ? <>Tới lượt bạn! ⏱ {Math.ceil(timeLeft / 1000)}s</> : <span className="muted">Chờ tới lượt…</span>}</div>
      <div className="row wrap">
        <button className="btn danger" disabled={!o} onClick={doFold}><kbd>F</kbd> Bỏ bài</button>
        <button className="btn" disabled={!o} onClick={doCall}>
          <kbd>C</kbd> {!o ? 'Theo' : o.canCheck ? 'Check' : `Theo ${fmt(o.toCall)}`}
        </button>
        <button className="btn primary" disabled={!canBR} onClick={doBR}>
          <kbd>{o?.canBet ? 'B' : 'R'}</kbd> {!canBR ? 'Tố' : amount >= o.maxTo ? 'All-in' : o.canBet ? 'Cược' : 'Tố lên'} {canBR ? fmt(amount) : ''}
        </button>
        <button className="btn warn" disabled={!o} onClick={doAllIn}><kbd>A</kbd> All-in {o ? fmt(o.maxTo - o.myBet) : ''}</button>
      </div>
      <div className={`row wrap pk-sizing ${canBR ? '' : 'off'}`} aria-hidden={!canBR}>
        <input type="range" min={o?.minTo ?? 0} max={o?.maxTo ?? 1} step={1} value={canBR ? amount : 0} disabled={!canBR}
          onChange={(e) => setAmount(Number(e.target.value))} />
        <input type="number" className="num" min={o?.minTo} max={o?.maxTo} value={canBR ? amount : ''} disabled={!canBR}
          onChange={(e) => setAmount(Number(e.target.value))} onBlur={() => setAmount(clamp(amount))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doBR(); } }} />
        {[['1', '⅓', 1 / 3], ['2', '½', 1 / 2], ['3', '¾', 3 / 4], ['4', 'Pot', 1]].map(([k, l, f]) => (
          <button key={k} className="btn sm" disabled={!canBR} onClick={() => preset(f)}><kbd>{k}</kbd> {l}</button>
        ))}
      </div>
    </div>
  );
}

/** Chủ phòng đổi small/big blind. Đang giữa ván thì áp dụng từ ván sau. */
function BlindsDialog({ s, act, onClose }) {
  const cur = s.nextBlinds || { smallBlind: s.smallBlind, bigBlind: s.bigBlind };
  const [sb, setSb] = useState(cur.smallBlind);
  const [bb, setBb] = useState(cur.bigBlind);
  const [busy, setBusy] = useState(false);
  const inHand = s.hand && s.hand.street !== 'done';
  const sbN = Math.floor(Number(sb)), bbN = Math.floor(Number(bb));
  const error = !(bbN >= 2) ? 'Big blind tối thiểu là 2'
    : bbN > s.config.buyIn ? `Big blind không được lớn hơn buy-in (${fmt(s.config.buyIn)})`
    : !(sbN >= 1) ? 'Small blind tối thiểu là 1'
    : sbN > bbN ? 'Small blind không được lớn hơn big blind' : null;
  const preset = (f) => { const b = Math.max(2, Math.round(cur.bigBlind * f)); setBb(b); setSb(Math.max(1, Math.floor(b / 2))); };

  const submit = async (e) => {
    e.preventDefault();
    if (error) return;
    setBusy(true);
    const res = await act({ type: 'setBlinds', smallBlind: sbN, bigBlind: bbN });
    setBusy(false);
    if (res) onClose();
  };

  return (
    <Modal title="Đổi blind" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="row pk-blind-fields">
          <div>
            <label>Small blind</label>
            <input type="number" min={1} value={sb} autoFocus onChange={(e) => setSb(e.target.value)} />
          </div>
          <div>
            <label>Big blind</label>
            <input type="number" min={2} value={bb} onChange={(e) => setBb(e.target.value)} />
          </div>
        </div>
        <div className="row wrap">
          <button type="button" className="btn sm" onClick={() => setSb(Math.max(1, Math.floor(bbN / 2)))}>SB = ½ BB</button>
          <button type="button" className="btn sm" onClick={() => preset(0.5)}>Giảm ½</button>
          <button type="button" className="btn sm" onClick={() => preset(1.5)}>× 1,5</button>
          <button type="button" className="btn sm" onClick={() => preset(2)}>× 2</button>
        </div>
        {error ? <div className="gate-error">{error}</div> : (
          <div className="muted small">
            {inHand ? 'Ván đang diễn ra: mức mới áp dụng từ ván sau.' : 'Áp dụng ngay cho ván tiếp theo.'} Raise tối thiểu bằng big blind.
          </div>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy || !!error}>Lưu</button>
        </div>
      </form>
    </Modal>
  );
}
