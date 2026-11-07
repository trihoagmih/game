import { useEffect, useMemo, useState } from 'react';
import { classify, beats, valueOf, COMBO_VI, SAM_RULES } from '@game/shared/samloc';
import { useApp } from '../store.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { SamLocGameView, SamLocView } from '@game/shared/views';
import type { SamCombo } from '@game/shared/samloc';
import type { ReactNode } from 'react';
import Card from '../components/Card.js';
import CardTable from '../components/CardTable.js';
import GameInfo from '../components/GameInfo.js';
import { ResultOverlay } from '../components/BoardRequests.js';
import { WaitingRoom, NextGameActions, WaitingSeats } from '../components/CardTableParts.js';
import { fmtSigned } from '../format.js';
import { Timer, Flame, Check } from 'lucide-react';
import { useCountdown, useHotkeys } from '../hooks.js';
import './SamLocGame.css';

type Act = AppContextValue['act'];
type SamPlayer = SamLocGameView['players'][number];

const comboLabel = (c: SamCombo | null) => (c ? `${COMBO_VI[c.type]}${c.type === 'straight' ? ` ${c.len} lá` : ''}` : '');

export default function SamLocGame({ room, state: s }: { room: ClientRoom; state: SamLocView }) {
  const { act } = useApp();
  const g = s.game;
  const timeLeft = useCountdown(s.turnLeft, room.receivedAt, !!s.turnLeft);
  if (!g || (!s.playing && !g.result)) return <WaitingRoom s={s} title="Bàn Sâm lốc" startLabel="Chia bài" rules={<Rules />} />;
  return (
    <div className="sl">
      <Table s={s} g={g} act={act} timeLeft={timeLeft} />
      {!g.result && <WaitingSeats s={s} />}
      {g.result && <Result s={s} g={g} />}
      <GameInfo><div className="panel"><Rules open /></div></GameInfo>
    </div>
  );
}

function Rules({ open = false }: { open?: boolean }) {
  return (
    <details className="rules" open={open}>
      <summary>Luật Sâm lốc tóm tắt</summary>
      <ul>
        <li>2–5 người, mỗi người 10 lá. Thứ tự: 3 &lt; 4 &lt; … &lt; K &lt; A &lt; 2 (heo). <b>Không xét chất</b> — cùng số không chặn được nhau.</li>
        <li>Bộ đánh: rác, đôi, sám (3 lá), tứ quý, sảnh (≥3 lá liên tiếp; A-2-3… hoặc …Q-K-A, không vòng K-A-2). Chặn bằng bộ cùng loại, cùng số lá, cao hơn. <b>Tứ quý chặt heo.</b></li>
        <li>Đã bỏ lượt thì nghỉ tới hết vòng. Mọi người bỏ thì người đánh cuối đi vòng mới.</li>
        <li><b>Báo 1:</b> người kế tiếp còn 1 lá thì đánh rác phải đánh lá lớn nhất.</li>
        <li><b>Báo Sâm</b> đầu ván: đi trước và phải đánh hết bài mà không ai chặn. Thành công: mỗi nhà trả {SAM_RULES.sam}. Bị chặn: đền mỗi nhà {SAM_RULES.sam}.</li>
        <li><b>Tới trắng</b> khi chia: tứ quý heo, sảnh rồng 10 lá, 5 đôi, 3 sám, 10 lá đồng màu — mỗi nhà trả {SAM_RULES.toiTrang}.</li>
        <li>Người hết bài đầu tiên thắng. Mỗi nhà trả {SAM_RULES.perCard}/lá còn lại; <b>cóng</b> (chưa đánh lá nào) trả {SAM_RULES.cong}; <b>thối heo</b> +{SAM_RULES.thoiHeo}/con; bị <b>chặt heo</b> trả người chặt {SAM_RULES.chatHeo}.</li>
      </ul>
    </details>
  );
}

function Table({ s, g, act, timeLeft }: { s: SamLocView; g: SamLocGameView; act: Act; timeLeft: number }) {
  const inGame = g.me >= 0;
  const me = inGame ? g.players[g.me] : null;
  const myTurn = inGame && g.phase === 'play' && g.turn === g.me;
  const n = g.players.length;

  // ----- Bài trên tay & chọn bài -----
  const hand = me?.hand || [];
  const [selected, setSelected] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const handKey = hand.join(',');
  useEffect(() => {
    setSelected((sel) => sel.filter((c) => hand.includes(c)));
    setCursor((c) => Math.min(c, Math.max(0, hand.length - 1)));
  }, [handKey]);
  const toggle = (c: string) => setSelected((sel) => (sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]));

  const lastCombo = useMemo(() => (g.lastPlay ? classify(g.lastPlay.cards) : null), [g.lastPlay]);
  const combo = useMemo(() => classify(selected), [selected]);
  const nextHasOne = inGame && g.players[(g.me + 1) % n].count === 1;
  const maxVal = hand.length ? Math.max(...hand.map(valueOf)) : 0;
  const problem = !selected.length ? null
    : !combo ? 'Bộ bài không hợp lệ'
    : lastCombo && !beats(combo, lastCombo) ? `Không chặn được ${comboLabel(lastCombo).toLowerCase()}`
    : combo.type === 'single' && nextHasOne && combo.top < maxVal ? 'Người sau báo 1: phải đánh lá lớn nhất'
    : null;
  const canPlay = myTurn && selected.length > 0 && !problem;

  const doPlay = () => canPlay && act({ type: 'play', cards: selected }).then((r) => r && setSelected([]));
  const doPass = () => myTurn && g.lastPlay && act({ type: 'pass' }).then((r) => r && setSelected([]));
  const samPending = inGame && g.phase === 'sam' && !g.samDecided.includes(g.me);
  const doSam = (yes: boolean) => samPending && act({ type: 'sam', yes });

  useHotkeys({
    Enter: doPlay,
    p: doPass,
    ' ': () => hand[cursor] && toggle(hand[cursor]),
    ArrowLeft: () => setCursor((c) => Math.max(0, c - 1)),
    ArrowRight: () => setCursor((c) => Math.min(hand.length - 1, c + 1)),
    ArrowUp: () => hand[cursor] && !selected.includes(hand[cursor]) && toggle(hand[cursor]),
    ArrowDown: () => hand[cursor] && selected.includes(hand[cursor]) && toggle(hand[cursor]),
    Escape: () => setSelected([]),
    y: () => doSam(true),
    k: () => doSam(false),
  }, inGame && !g.result);

  const status = (p: SamPlayer, i: number) => {
    const tags: ReactNode[] = [];
    if (g.samBy === i) tags.push(<span key="sam" className="badge sam"><Flame size={12} aria-hidden /> Báo Sâm</span>);
    if (!g.result && p.count === 1) tags.push(<span key="one" className="badge danger">Báo 1!</span>);
    if (g.phase === 'play' && p.passed) tags.push(<span key="pass" className="badge">Bỏ lượt</span>);
    if (g.phase === 'sam' && g.samDecided.includes(i) && g.samBy !== i) tags.push(<span key="no" className="badge">Không báo</span>);
    const seat = s.seats[s.gameSeats[i]];
    if (seat?.left) tags.push(<span key="left" className="badge warn">Đã rời</span>);
    else if (seat && !seat.online) tags.push(<span key="off" className="badge warn">Mất kết nối</span>);
    return tags;
  };
  const isActive = (i: number) => !g.result && ((g.phase === 'play' && g.turn === i) || (g.phase === 'sam' && !g.samDecided.includes(i)));
  // Đồng hồ luôn giữ chỗ (ẩn khi không tới lượt) → dòng tên không đổi chiều cao
  const turnTimer = (i: number) => (
    <span className={`tl-timer ${isActive(i) ? '' : 'off'}`} aria-hidden={!isActive(i)}><Timer size={13} aria-hidden /> {isActive(i) ? Math.ceil(timeLeft / 1000) : 0}s</span>
  );

  // Ghế quanh bàn: đối thủ thấy lưng bài (hết ván thì lật bài), ghế của mình chỉ hiện tên + trạng thái
  const base = inGame ? g.me : 0;
  const seats = g.players.map((p, i) => ({
    key: p.id,
    rel: (i - base + n) % n,
    me: i === g.me,
    active: isActive(i),
    node: (
      <div className={`sl-opp ${isActive(i) ? 'turn' : ''} ${g.lastPlay?.by === i ? 'last' : ''}`}>
        <div className="tl-head">
          <b className="seat-name">{p.name}</b>{i === g.me && <span className="seat-me">bạn</span>}
          <span className="felt-muted small">{p.count} lá</span>
          {turnTimer(i)}
        </div>
        <div className="row wrap sl-tags">{status(p, i)}</div>
        {i !== g.me && (
          <div className="tl-hand-back">
            {p.hand ? p.hand.map((c) => <Card key={c} card={c} size="sm" />)
              : <span className="card-fan" aria-label={`${p.count} lá`}>{Array.from({ length: p.count }).map((_, j) => <Card key={j} card="??" size="xs" />)}</span>}
          </div>
        )}
      </div>
    ),
  }));

  const center = (
    <>
      {g.phase === 'sam' && !g.result ? (
        <div className="sl-sam">
          <div className="sl-sam-title"><Flame size={20} aria-hidden /> Báo Sâm? <span className="tl-timer"><Timer size={14} aria-hidden /> {Math.ceil(timeLeft / 1000)}s</span></div>
          <div className="felt-muted small">Đi trước và phải đánh hết bài mà không ai chặn được. Thành công +{SAM_RULES.sam}/nhà, bị chặn đền {SAM_RULES.sam}/nhà.</div>
          {samPending ? (
            <div className="row">
              <button className="btn cta" onClick={() => doSam(true)}><kbd>Y</kbd> Báo Sâm</button>
              <button className="btn" onClick={() => doSam(false)}><kbd>K</kbd> Không báo</button>
            </div>
          ) : <div className="felt-muted small">Đang chờ người khác quyết định…</div>}
        </div>
      ) : g.lastPlay ? (
        <div className="sl-pile">
          <div className="felt-muted small">{g.players[g.lastPlay.by].name} — {comboLabel(lastCombo)}</div>
          <div className="sl-pile-cards">{g.lastPlay.cards.map((c) => <Card key={c} card={c} size="md" />)}</div>
        </div>
      ) : !g.result && (
        <div className="sl-pile empty felt-muted">{g.turn >= 0 && <><b>{g.players[g.turn].name}</b> đi vòng mới</>}</div>
      )}
      {!g.result && g.phase === 'play' && (
        <div className="tl-status" role="status" aria-live="polite">Lượt: <b>{g.players[g.turn].name}</b>{g.samBy >= 0 && <span className="felt-muted"> · {g.players[g.samBy].name} đang đi Sâm</span>}</div>
      )}
      <div className="tl-log">{g.log.slice(-3).map((l, i) => <div key={i} className="small felt-muted">{l}</div>)}</div>
    </>
  );

  return (
    <div className="sl-board">
      <CardTable seats={seats} center={center} className="ct-samloc" />
      {inGame && (
        <div className={`ct-hand-panel ${myTurn ? 'turn' : ''}`}>
          <div className="tl-hand">
            {hand.map((c, i) => (
              <Card key={c} card={c} size="lg" selected={selected.includes(c)} focused={i === cursor}
                onClick={() => { setCursor(i); toggle(c); }} />
            ))}
          </div>
          {!g.result && (
            <div className="row wrap tl-actions">
              {myTurn ? <span className="your-turn">Tới lượt bạn{g.lastPlay ? ': chặn hoặc bỏ lượt' : ': đi vòng mới'}</span>
                : <span className="muted">{g.phase === 'sam' ? 'Đang chờ báo Sâm…' : 'Chờ tới lượt…'}</span>}
              {/* Luôn giữ chỗ cho nhãn bộ bài đang chọn → hàng nút không xô lệch */}
              <span className={`sl-sel ${!selected.length ? 'off' : problem ? 'bad' : 'ok'}`} aria-live="polite">
                {!selected.length ? 'Chọn lá để đánh' : problem || <><Check size={13} aria-hidden /> {comboLabel(combo)}</>}
              </span>
              <button className="btn primary" disabled={!canPlay} onClick={doPlay}><kbd>Enter</kbd> Đánh</button>
              <button className="btn" disabled={!myTurn || !g.lastPlay} onClick={doPass}><kbd>P</kbd> Bỏ lượt</button>
              <button className="btn ghost sm" disabled={!selected.length} onClick={() => setSelected([])}><kbd>Esc</kbd> Bỏ chọn</button>
            </div>
          )}
        </div>
      )}
      {!inGame && <div className="muted small center">Bạn đang xem ván này.</div>}
    </div>
  );
}

function Result({ s, g }: { s: SamLocView; g: SamLocGameView }) {
  const r = g.result;
  if (!r) return null;
  const title = r.type === 'samFail'
    ? `${g.players[r.samBy].name} bị ${g.players[r.winner].name} chặn Sâm!`
    : `${g.players[r.winner].name} — ${r.text}`;
  return (
    <ResultOverlay over peek="Xem bàn" resetKey={s.gameNo} title={title}>
    <div className="tl-result">
      <table className="result-table">
        <thead><tr><th>Người chơi</th><th>Bài còn lại</th><th>Chi tiết</th><th>Thắng/thua</th></tr></thead>
        <tbody>
          {g.players.map((p, i) => (
            <tr key={p.id}>
              <td>{p.name}{i === r.winner && r.type !== 'samFail' ? ' 🏆' : ''}</td>
              <td>
                {p.hand?.length ? <span className="sl-left-cards">{p.hand.map((c) => <Card key={c} card={c} size="sm" />)}</span> : <span className="muted">Hết bài</span>}
              </td>
              <td className="small sl-lines">
                {r.lines[i].length ? r.lines[i].map((l, k) => (
                  <div key={k}>{l.reason} <span className="muted">({g.players[l.with].name})</span> <span className={l.amount >= 0 ? 'pos' : 'neg'}>{fmtSigned(l.amount * s.config.unit)}</span></div>
                )) : '—'}
              </td>
              <td className={r.scores[i] >= 0 ? 'pos' : 'neg'}><b>{fmtSigned(r.scores[i] * s.config.unit)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NextGameActions s={s} />
    </div>
    </ResultOverlay>
  );
}
