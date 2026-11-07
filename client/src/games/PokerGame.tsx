import { useEffect, useMemo, useState } from 'react';
import { Pencil, BookOpen, Eye, Pause } from 'lucide-react';
import { useRoomApp } from '../store.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { PokerView } from '@game/shared/views';
import type { FormEvent } from 'react';
import Card from '../components/Card.js';
import { useCountdown, useHotkeys } from '../hooks.js';
import PokerHandLog from './PokerHandLog.js';
import Modal from '../components/Modal.js';
import GameInfo from '../components/GameInfo.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import { fmtNum } from '../format.js';
import { PokerRules, BestHandPanel, myHole } from './PokerPanels.js';
import { describeHand } from '@game/shared/poker';
import './PokerGame.css';

type Act = AppContextValue['act'];
type BetOptions = PokerView['options'];

const STREET_VI: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', done: 'Kết thúc' };

export default function PokerGame({ room, state: s }: { room: ClientRoom; state: PokerView }) {
  const { act, call, user } = useRoomApp();
  const [editBlinds, setEditBlinds] = useState(false);
  const isOwner = room.ownerId === user.id;
  const h = s.hand;
  const N = s.seats.length;
  const mySeat = s.mySeat;
  const mine = mySeat >= 0 ? s.seats[mySeat] : null;
  const base = mySeat >= 0 ? mySeat : 0;
  const o = s.options;
  // Luật chơi mở dạng popup (không đẩy nội dung xuống dưới bàn)
  const [showRules, setShowRules] = useState(false);
  const toggleRules = () => setShowRules((v) => !v);
  const hole = myHole(s);
  const myCat = useMemo(() => (hole ? describeHand(hole, h?.board || []).cat : -1), [hole?.join(), h?.board?.join()]);
  useHotkeys({
    t: () => s.canRabbit && act({ type: 'rabbit' }),
    s: () => s.canShow && act({ type: 'show' }),
    l: toggleRules,
  });
  const timeLeft = useCountdown(s.turnLeft, room.receivedAt, !!s.turnLeft);
  const nextIn = useCountdown(s.nextHandIn, room.receivedAt, !!s.nextHandIn);

  const winners = useMemo(() => {
    const w = new Set<number>();
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
            {h && <div className="pk-pot">Pot: <b>{fmtNum(h.pot)}</b> <span className="muted">· {STREET_VI[h.street]}</span>{h.rabbit && <span className="pk-rabbit-note" title="Các lá mờ là bài lẽ ra sẽ ra, không tính"> · 🐇 rabbit</span>}</div>}
            {h?.result && (
              <div className="pk-result">
                {h.result.pots.map((p, k) => (
                  <div key={k}>🏆 {p.winners.map((w) => s.seats[w]?.name || '?').join(', ')} thắng {fmtNum(p.amount)}{p.hand ? ` — ${p.hand}` : ''}</div>
                ))}
              </div>
            )}
            {!h?.street || h.street === 'done' ? (
              <div className="muted small pk-next">
                {!s.started ? 'Chờ mọi người sẵn sàng, chủ phòng bấm Bắt đầu'
                  : nextIn ? `Ván mới sau ${Math.ceil(nextIn / 1000)} giây…` : s.seats.filter((x) => x && x.chips > 0 && !x.sitOut).length < 2 ? 'Đang chờ ít nhất 2 người chơi…' : ''}
              </div>
            ) : null}
            <div className="muted small">
              Blind {fmtNum(s.smallBlind)}/{fmtNum(s.bigBlind)}
              {isOwner && <button className="link pk-blind-edit" title="Đổi blind" aria-label="Đổi blind" onClick={() => setEditBlinds(true)}><Pencil size={14} aria-hidden /></button>}
              {isOwner && s.started && <button className="link pk-pause" title="Không chia ván mới (ván đang chơi vẫn chơi nốt)" onClick={() => act({ type: 'pause' })}><Pause size={13} aria-hidden /> Tạm dừng</button>}
            </div>
            {mine && mine.chips < s.bigBlind && !(h && h.street !== 'done' && mine.inHand) && (
              <button className="btn cta sm" onClick={() => act({ type: 'rebuy' })}>Nạp thêm {fmtNum(s.config.buyIn)} chip</button>
            )}
            {mine?.sitOut && (
              <button className="btn sm" onClick={() => act({ type: 'sitout' })}>Quay lại chơi</button>
            )}
            {s.nextBlinds && <div className="pk-next-blinds small">Từ ván sau: {fmtNum(s.nextBlinds.smallBlind)}/{fmtNum(s.nextBlinds.bigBlind)}</div>}
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
                    {!s.started && !seat.left && <ReadyMark id={seat.id} ready={s.ready} ownerId={room.ownerId} />}
                  </div>
                  <div className="pk-chips">💰 {fmtNum(seat.chips)}</div>
                  {seat.lastAction && <div className="pk-act">{seat.lastAction}</div>}
                  {shown && (shown.hand || shown.voluntary) && (
                    <div className="pk-hand">{shown.hand}{shown.voluntary && <span className="pk-showed">{shown.hand ? ' · ' : ''}show</span>}</div>
                  )}
                  {toAct && <div className="timebar"><div style={{ width: `${(timeLeft / s.turnTotal) * 100}%` }} /></div>}
                </div>
                {h && h.street !== 'done' && h.dealer === i && <div className="pk-dealer">D</div>}
                {seat.bet > 0 && <div className="pk-bet">{fmtNum(seat.bet)}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {!s.started && (
        <div className="board-actions pk-start">
          <StartBar players={s.seats.filter((x) => x != null).filter((x) => !x.left)} ready={s.ready} waitingFor={s.waitingFor} seated={mySeat >= 0}
            startLabel="Bắt đầu chia bài" />
        </div>
      )}
      {mySeat >= 0 && (
        <ActionBar s={s} o={o} act={act} myTurn={!!o} timeLeft={timeLeft} />
      )}
      {mySeat < 0 && <div className="muted center small pk-watch">Bạn đang xem. Chọn "Ngồi đây" ở ghế trống để chơi.</div>}
      <div className="pk-extras">
        <BestHandPanel s={s} />
        <div className="row pk-extras-bar">
          <button className="btn sm ghost" aria-haspopup="dialog" onClick={toggleRules}>
            <BookOpen size={14} aria-hidden /> <kbd>L</kbd> Xem luật chơi
          </button>
        </div>
        {showRules && (
          <Modal title="Luật Texas Hold'em" onClose={() => setShowRules(false)} wide>
            <PokerRules s={s} current={myCat} bare />
          </Modal>
        )}
      </div>
      <GameInfo>
        {mySeat >= 0 && (
          <div className="panel row wrap pk-mybar">
            <button className="btn sm" onClick={() => act({ type: 'sitout' })}>{mine?.sitOut ? 'Quay lại chơi' : 'Nghỉ ván sau'}</button>
            <button className="btn ghost sm" onClick={() => call('room:stand', {})}>Đứng dậy xem</button>
          </div>
        )}
        {h && (
          <details className="panel pk-log" open>
            <summary>Diễn biến ván #{h.no}</summary>
            {h.log.map((l, i) => <div key={i} className="small">{l}</div>)}
          </details>
        )}
        <PokerHandLog s={s} />
      </GameInfo>
      {editBlinds && <BlindsDialog s={s} act={act} onClose={() => setEditBlinds(false)} />}
    </div>
  );
}

function ActionBar({ s, o, act, myTurn, timeLeft }: { s: PokerView; o: BetOptions; act: Act; myTurn: boolean; timeLeft: number }) {
  const bb = s.bigBlind;
  const [amount, setAmount] = useState(o ? o.minTo : 0);
  // Chuỗi đang gõ trong ô số tiền (null = hiển thị amount). Tách riêng để xóa hết được số cũ, kể cả số 0.
  const [draft, setDraft] = useState<string | null>(null);
  const key = o ? `${s.hand?.no}:${o.currentBet}:${o.minTo}` : '';
  useEffect(() => { if (o) { setAmount(o.minTo); setDraft(null); } }, [key]);

  const canBR = o && (o.canBet || o.canRaise);
  const clamp = (v: number) => (o ? Math.max(o.minTo, Math.min(o.maxTo, Math.round(v))) : v);
  const preset = (f: number) => {
    if (!o) return;
    const toCall = o.currentBet - o.myBet;
    setAmount(clamp(o.currentBet + f * (o.pot + toCall)));
    setDraft(null);
  };

  const doFold = () => o && act({ type: 'act', action: 'fold' });
  const doCall = () => o && act({ type: 'act', action: o.canCheck ? 'check' : 'call' });
  const doCheck = () => o && o.canCheck && act({ type: 'act', action: 'check' });
  const doBR = () => {
    if (!canBR || !o) return;
    const v = clamp(amount);
    setAmount(v);
    setDraft(null);
    act({ type: 'act', action: v >= o.maxTo ? 'allin' : o.canBet ? 'bet' : 'raise', amount: v });
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
    ArrowUp: (e) => { if (canBR) { setDraft(null); setAmount((v) => clamp(v + (e.shiftKey ? 10 : 1) * bb)); } },
    ArrowDown: (e) => { if (canBR) { setDraft(null); setAmount((v) => clamp(v - (e.shiftKey ? 10 : 1) * bb)); } },
    1: () => preset(1 / 3),
    2: () => preset(1 / 2),
    3: () => preset(3 / 4),
    4: () => preset(1),
  }, myTurn);

  // Luôn giữ nguyên khung (nút + thanh chọn mức cược) kể cả khi chưa tới lượt → không nhảy layout
  return (
    <div className={`pk-actions ${o ? '' : 'idle'}`}>
      <div className="pk-turn">
        {o ? <>Tới lượt bạn! ⏱ {Math.ceil(timeLeft / 1000)}s</> : <span className="muted">{s.hand?.street === 'done' ? 'Ván đã kết thúc' : 'Chờ tới lượt…'}</span>}
        {s.canShow && (
          <button className="btn sm cta pk-show" title="Lật 2 lá tẩy của bạn cho cả bàn xem (S)" onClick={() => act({ type: 'show' })}>
            <Eye size={14} aria-hidden /> <kbd>S</kbd> Show bài
          </button>
        )}
      </div>
      <div className="row wrap">
        <button className="btn danger" disabled={!o} onClick={doFold}><kbd>F</kbd> Bỏ bài</button>
        <button className="btn" disabled={!o} onClick={doCall}>
          <kbd>C</kbd> {!o ? 'Theo' : o.canCheck ? 'Check' : `Theo ${fmtNum(o.toCall)}`}
        </button>
        <button className="btn primary" disabled={!canBR} onClick={doBR}>
          <kbd>{o?.canBet ? 'B' : 'R'}</kbd> {!canBR ? 'Tố' : amount >= o.maxTo ? 'All-in' : o.canBet ? 'Cược' : 'Tố lên'} {canBR ? fmtNum(amount) : ''}
        </button>
        <button className="btn warn" disabled={!o} onClick={doAllIn}><kbd>A</kbd> All-in {o ? fmtNum((o.allInTo ?? o.maxTo) - o.myBet) : ''}</button>
      </div>
      <div className={`row wrap pk-sizing ${canBR ? '' : 'off'}`} aria-hidden={!canBR}>
        <input type="range" min={o?.minTo ?? 0} max={o?.maxTo ?? 1} step={1} value={canBR ? amount : 0} disabled={!canBR}
          onChange={(e) => { setAmount(Number(e.target.value)); setDraft(null); }} />
        <input type="text" inputMode="numeric" className="num" aria-label="Số tiền cược" value={canBR ? (draft ?? String(amount)) : ''} disabled={!canBR}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
            setDraft(d);
            if (d) setAmount(Number(d));
          }}
          onBlur={() => { setAmount(clamp(amount)); setDraft(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doBR(); } }} />
        {([['1', '⅓', 1 / 3], ['2', '½', 1 / 2], ['3', '¾', 3 / 4], ['4', 'Pot', 1]] as const).map(([k, l, f]) => (
          <button key={k} className="btn sm" disabled={!canBR} onClick={() => preset(f)}><kbd>{k}</kbd> {l}</button>
        ))}
      </div>
    </div>
  );
}

/** Chủ phòng đổi small/big blind. Đang giữa ván thì áp dụng từ ván sau. */
function BlindsDialog({ s, act, onClose }: { s: PokerView; act: Act; onClose: () => void }) {
  const cur = s.nextBlinds || { smallBlind: s.smallBlind, bigBlind: s.bigBlind };
  const [sb, setSb] = useState<number | string>(cur.smallBlind);
  const [bb, setBb] = useState<number | string>(cur.bigBlind);
  const [busy, setBusy] = useState(false);
  const inHand = s.hand && s.hand.street !== 'done';
  const sbN = Math.floor(Number(sb)), bbN = Math.floor(Number(bb));
  const error = !(bbN >= 2) ? 'Big blind tối thiểu là 2'
    : bbN > s.config.buyIn ? `Big blind không được lớn hơn buy-in (${fmtNum(s.config.buyIn)})`
    : !(sbN >= 1) ? 'Small blind tối thiểu là 1'
    : sbN > bbN ? 'Small blind không được lớn hơn big blind' : null;
  const preset = (f: number) => { const b = Math.max(2, Math.round(cur.bigBlind * f)); setBb(b); setSb(Math.max(1, Math.floor(b / 2))); };

  const submit = async (e: FormEvent) => {
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
