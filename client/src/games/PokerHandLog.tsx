import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { queryGame } from '../socket.js';
import type { PokerAction } from '@game/shared/poker';
import type { PokerHandLog as HandLog, PokerView } from '@game/shared/views';

type HandEntry = HandLog[number];
import { useApp } from '../store.js';
import { useHotkeys } from '../hooks.js';
import Card from '../components/Card.js';
import Modal from '../components/Modal.js';
import { cardLabel } from '@game/shared/cards';
import { fmtNum, fmtTime } from '../format.js';
import './PokerHandLog.css';

const fmtNet = (n: number) => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(-n)}` : '0');
const STREETS: [string, string, number][] = [['preflop', 'Preflop', 0], ['flop', 'Flop', 3], ['turn', 'Turn', 4], ['river', 'River', 5]];

function actionText(a: PokerAction, name: string) {
  const allIn = a.allIn ? ' (all-in)' : '';
  switch (a.type) {
    case 'sb': return `${name} đặt small blind ${fmtNum(a.amount)}${allIn}`;
    case 'bb': return `${name} đặt big blind ${fmtNum(a.amount)}${allIn}`;
    case 'fold': return `${name} bỏ bài`;
    case 'check': return `${name} check`;
    case 'call': return `${name} theo ${fmtNum(a.amount)}${allIn}`;
    case 'bet': return `${name} cược ${fmtNum(a.to)}${allIn}`;
    case 'raise': return `${name} tố lên ${fmtNum(a.to)}${allIn}`;
    default: return `${name} ${a.type}`;
  }
}

const nameOf = (e: HandEntry, seat: number) => e.players.find((p) => p.seat === seat)?.name || `Ghế ${seat + 1}`;

/** Chuyển một ván sang dạng text để sao chép / chia sẻ. */
function handToText(e: HandEntry) {
  const L: string[] = [];
  L.push(`Poker Hold'em No-Limit — Ván #${e.no} — Blind ${fmtNum(e.smallBlind)}/${fmtNum(e.bigBlind)} — ${new Date(e.startedAt).toLocaleString('vi-VN')}`);
  L.push(`Dealer: ${nameOf(e, e.dealer)}`);
  for (const p of e.players) {
    L.push(`Ghế ${p.seat + 1}: ${p.name} (${fmtNum(p.startChips)})${p.hole ? ` [${p.hole.map(cardLabel).join(' ')}]` : ''}`);
  }
  for (const [st, label, n] of STREETS) {
    const acts = e.actions.filter((a) => a.street === st);
    if (!acts.length && e.board.length < n) continue;
    L.push(`*** ${label.toUpperCase()}${n ? ` [${e.board.slice(0, n).map(cardLabel).join(' ')}]` : ''} ***`);
    for (const a of acts) L.push(actionText(a, nameOf(e, a.seat)));
  }
  if (e.rabbit) L.push(`*** RABBIT (không tính) [${e.rabbit.map(cardLabel).join(' ')}] ***`);
  if (Object.keys(e.shown).length) {
    L.push(e.showdown ? '*** SHOWDOWN ***' : '*** SHOW BÀI ***');
    for (const [seat, s] of Object.entries(e.shown)) L.push(`${nameOf(e, Number(seat))}: [${s.hole.map(cardLabel).join(' ')}]${s.hand ? ` — ${s.hand}` : ''}${s.voluntary ? ' (chủ động show)' : ''}`);
  }
  L.push('*** KẾT QUẢ ***');
  e.pots.forEach((pt, k) => L.push(`${e.pots.length > 1 ? (k ? `Pot phụ ${k}` : 'Pot chính') : 'Pot'} ${fmtNum(pt.amount)}: ${pt.winners.map((w) => nameOf(e, w)).join(', ')}${pt.hand ? ` (${pt.hand})` : ''}`));
  for (const p of e.players) L.push(`${p.name}: ${fmtNet(p.net)}`);
  return L.join('\n');
}

/** Panel Hands log dưới bàn Poker + modal xem chi tiết từng ván. Phím tắt: H. */
export default function PokerHandLog({ s }: { s: PokerView }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [hands, setHands] = useState<HandLog>([]);
  const [sel, setSel] = useState<number | null>(null); // index trong `hands`
  const [loading, setLoading] = useState(false);
  const needFetch = open || sel !== null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await queryGame({ type: 'handLog' });
      setHands(data);
      return data;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Tải lại khi có ván mới kết thúc (chỉ khi đang mở)
  useEffect(() => { if (needFetch) load(); }, [needFetch, s.handLogLast, load]);

  const openLatest = async () => {
    const list = hands.length && hands[0].no === s.handLogLast ? hands : await load();
    if (list.length) setSel(0);
  };
  useHotkeys({ h: () => { if (s.handLogCount) openLatest(); } });

  return (
    <>
      <details className="panel pk-handlog" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <ScrollText size={18} aria-hidden /> Hands log <span className="muted">({s.handLogCount} ván)</span>
          <kbd className="hide-sm">H</kbd>
        </summary>
        {s.handLogCount === 0 ? (
          <div className="muted small">Chưa có ván nào kết thúc.</div>
        ) : (
          <div className="hl-list">
            <div className="hl-row hl-head muted small">
              <span>Ván</span><span>Giờ</span><span>Bài chung</span><span>Thắng</span><span className="num">Pot</span><span className="num">Bạn</span>
            </div>
            {loading && !hands.length && <div className="muted small">Đang tải…</div>}
            {hands.map((e, i) => {
              const me = e.players.find((p) => p.me);
              const winners = [...new Set(e.pots.flatMap((p) => p.winners))].map((w) => nameOf(e, w));
              return (
                <button key={e.no} className="hl-row" onClick={() => setSel(i)}>
                  <span>#{e.no}</span>
                  <span className="muted">{fmtTime(e.endedAt, true)}</span>
                  <span className="hl-board">
                    {e.board.length ? e.board.map(cardLabel).join(' ') : !e.rabbit && <span className="muted">—</span>}
                    {e.rabbit && <span className="hl-rabbit" title="Rabbit hunt"> 🐇{e.rabbit.map(cardLabel).join(' ')}</span>}
                  </span>
                  <span>{winners.join(', ')}{e.showdown ? '' : <span className="muted small"> (không lật)</span>}</span>
                  <span className="num">{fmtNum(e.pot)}</span>
                  <span className={`num ${me ? (me.net > 0 ? 'pos' : me.net < 0 ? 'neg' : '') : 'muted'}`}>{me ? fmtNet(me.net) : '—'}</span>
                </button>
              );
            })}
          </div>
        )}
      </details>
      {sel !== null && hands[sel] && (
        <HandDetail e={hands[sel]} onClose={() => setSel(null)}
          onPrev={sel < hands.length - 1 ? () => setSel(sel + 1) : null}
          onNext={sel > 0 ? () => setSel(sel - 1) : null}
          onCopy={() => navigator.clipboard?.writeText(handToText(hands[sel])).then(() => toast('Đã sao chép ván #' + hands[sel].no))} />
      )}
    </>
  );
}

function HandDetail({ e, onClose, onPrev, onNext, onCopy }: {
  e: HandEntry; onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null; onCopy: () => void;
}) {
  // useHotkeys bỏ qua phím khi modal mở, nên tự bắt ←/→ để chuyển ván
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowLeft' && onPrev) { ev.preventDefault(); onPrev(); }
      if (ev.key === 'ArrowRight' && onNext) { ev.preventDefault(); onNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);
  const badge = (seat: number) => [seat === e.dealer && 'D', seat === e.sb && 'SB', seat === e.bb && 'BB'].filter(Boolean);
  return (
    <Modal title={`Ván #${e.no}`} onClose={onClose} wide>
      <div className="hl-detail">
        <div className="row wrap hl-meta muted small">
          <span>{new Date(e.startedAt).toLocaleString('vi-VN')}</span>
          <span>Blind {fmtNum(e.smallBlind)}/{fmtNum(e.bigBlind)}</span>
          <span>Pot {fmtNum(e.pot)}</span>
          <span>{e.showdown ? 'Có showdown' : 'Không lật bài'}</span>
        </div>

        <table className="hl-players">
          <thead><tr><th>Người chơi</th><th className="num">Stack đầu</th><th>Bài tẩy</th><th className="num">Kết quả</th></tr></thead>
          <tbody>
            {e.players.map((p) => (
              <tr key={p.seat} className={p.me ? 'me' : ''}>
                <td>
                  {p.name}{p.me && <span className="muted"> (bạn)</span>}
                  {badge(p.seat).map((b) => <span key={String(b)} className="hl-badge">{b}</span>)}
                </td>
                <td className="num">{fmtNum(p.startChips)}</td>
                <td>
                  {p.hole ? <span className="hl-cards">{p.hole.map((c) => <Card key={c} card={c} size="sm" />)}</span>
                    : <span className="muted small">{p.folded ? 'Bỏ bài (ẩn)' : 'Ẩn'}</span>}
                </td>
                <td className={`num ${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : ''}`}><b>{fmtNet(p.net)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>

        {STREETS.map(([st, label, n]) => {
          const acts = e.actions.filter((a) => a.street === st);
          if (!acts.length && e.board.length < n) return null;
          return (
            <div key={st} className="hl-street">
              <div className="hl-street-head">
                <b>{label}</b>
                {n > 0 && <span className="hl-cards">{e.board.slice(0, n).map((c, i) => <Card key={c} card={c} size="sm" dim={i < n - (st === 'flop' ? 3 : 1)} />)}</span>}
              </div>
              {acts.length ? (
                <ul>{acts.map((a, i) => <li key={i} className={`hl-act ${a.type}`}>{actionText(a, nameOf(e, a.seat))}</li>)}</ul>
              ) : <div className="muted small">Không ai hành động (đã all-in)</div>}
            </div>
          );
        })}

        {e.rabbit && (
          <div className="hl-street">
            <div className="hl-street-head">
              <b>🐇 Rabbit hunt</b>
              <span className="hl-cards hl-rabbit-cards">{e.rabbit.map((c) => <Card key={c} card={c} size="sm" />)}</span>
            </div>
            <div className="muted small">Các lá bài chung lẽ ra sẽ ra nếu ván tiếp tục — không ảnh hưởng kết quả.</div>
          </div>
        )}

        {Object.keys(e.shown).length > 0 && (
          <div className="hl-street">
            <div className="hl-street-head"><b>{e.showdown ? 'Showdown' : 'Show bài'}</b></div>
            <ul>
              {Object.entries(e.shown as Record<string, {hole: string[]; hand: string; voluntary: boolean}>).map(([seat, sh]) => (
                <li key={seat}>{nameOf(e, Number(seat))}: <span className="hl-cards">{sh.hole.map((c) => <Card key={c} card={c} size="sm" />)}</span>{sh.hand ? ` — ${sh.hand}` : ''}{sh.voluntary && <span className="muted"> (chủ động show)</span>}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="hl-street">
          <div className="hl-street-head"><b>Kết quả</b></div>
          <ul>
            {e.pots.map((pt, k) => (
              <li key={k}>
                🏆 {e.pots.length > 1 ? (k ? `Pot phụ ${k}` : 'Pot chính') : 'Pot'} <b>{fmtNum(pt.amount)}</b>: {pt.winners.map((w) => nameOf(e, w)).join(', ')}
                {pt.hand && <span className="muted"> ({pt.hand})</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="row end wrap">
          <button className="btn ghost sm" disabled={!onPrev} onClick={onPrev ?? undefined}>← Ván trước</button>
          <button className="btn ghost sm" disabled={!onNext} onClick={onNext ?? undefined}>Ván sau →</button>
          <button className="btn sm" onClick={onCopy}>📋 Sao chép dạng text</button>
        </div>
      </div>
    </Modal>
  );
}
