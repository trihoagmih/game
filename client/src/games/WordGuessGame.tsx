import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Timer, Flag, Trophy, Users, Swords, CalendarDays } from 'lucide-react';
import { splitWord, partLabel, scoreGuess, PARTS, TONE_NAMES } from '@game/shared/wordguess';
import { useRoomApp } from '../store.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { Marks } from '@game/shared/wordguess';
import type { GuessBoardView, GuessView, WordGuessGameView, WordGuessHistoryView, WordGuessScoreView, WordGuessView } from '@game/shared/views';
import type { FormEvent } from 'react';

type Act = AppContextValue['act'];
type Part = typeof PARTS[number];
type Mark = Marks[Part];
import { useCountdown } from '../hooks.js';
import { fmtTime } from '../format.js';
import GameInfo from '../components/GameInfo.js';
import StartBar from '../components/StartBar.js';
import GameOverDialog from '../components/GameOverDialog.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import './WordGuessGame.css';

const PART_NAMES: Record<string, string> = { onset: 'Âm đầu', rhyme: 'Vần', tone: 'Thanh' };
const RANK: Record<string, number> = { g: 3, y: 2, x: 1 };
const mmss = (ms: number) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export default function WordGuessGame({ room, state: s }: { room: ClientRoom; state: WordGuessView }) {
  const { act, call, user } = useRoomApp();
  const [giveup, setGiveup] = useState(false);
  const g = s.game;
  const me = s.myId;
  const playing = s.status === 'playing';
  const left = useCountdown(g?.timeLeft || 0, room.receivedAt, playing);
  const coop = g ? g.mode === 'coop' : s.options.mode === 'coop';
  const board = g ? (coop ? g.shared : g.mine) : null;
  const canGuess = playing && !!me && !!board && !board.done;
  const canEdit = !playing && (!!me || room.ownerId === user.id);

  const over = s.status === 'over' && !!g?.result;

  return (
    <div className="wg">
      <div className="wg-main">
        <GameOverDialog over={over} title={over ? resultTitle(g, me) : ''} startLabel="Ván mới" min={1}
          detail={over ? <>Từ bí mật: <b className="wg-secret">{g.secret}</b>{g.daily && <><br />Từ của ngày — ngày mai có từ mới.</>}</> : null}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!me} reviewLabel="Xem lại bàn đoán"
          seatBtn={me ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>} />
        <div className="wg-top">
          <span className="wg-mode">{coop ? <><Users size={15} aria-hidden /> Cùng đoán</> : <><Swords size={15} aria-hidden /> Đua</>}{(g ? g.daily : s.options.daily) && <> · <CalendarDays size={14} aria-hidden /> Từ của ngày</>}</span>
          {playing && <span className={`wc-time ${left < 30000 ? 'low' : ''}`}><Timer size={14} aria-hidden /> {mmss(left)}</span>}
        </div>

        <div className="panel wg-stage">
          {!g || s.status === 'waiting' ? (
            <Setup s={s} canEdit={canEdit} act={act} />
          ) : (
            <>
              {s.status === 'over' && <Result g={g} me={me} />}
              <Board board={board} max={g.maxGuesses} showBy={coop} />
              {canGuess && <GuessInput act={act} count={board.count} max={g.maxGuesses} />}
              {playing && board?.done && !coop && (
                <div className="muted small">{board.solved ? `🎉 Bạn đoán đúng sau ${board.count} lượt! Chờ mọi người…` : 'Bạn đã hết lượt — chờ mọi người…'}</div>
              )}
              {playing && !me && <div className="muted small">Bạn đang xem</div>}
              {board && <Tracker guesses={board.guesses} />}
            </>
          )}
        </div>

        {!over && <div className="board-actions">
          {me ? (
            playing ? (
              canGuess && <button className="btn danger" onClick={() => setGiveup(true)}><Flag size={16} aria-hidden /> Chịu thua</button>
            ) : (
              <>
                <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated min={1}
                  startLabel={s.status === 'over' ? 'Ván mới' : 'Bắt đầu'} />
                <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
              </>
            )
          ) : (
            <span className="muted small ba-note">
              Bạn đang xem.{' '}
              {!playing && s.seats.length < s.options.maxSeats && <button className="btn primary sm" onClick={() => call('room:sit', {})}>Vào chơi</button>}
            </span>
          )}
          {!me && !playing && <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={false} min={1}
            startLabel={s.status === 'over' ? 'Ván mới' : 'Bắt đầu'} />}
        </div>}
        {giveup && (
          <ConfirmDialog title="Chịu thua?" danger okLabel="Chịu thua" icon={<Flag size={22} />}
            onOk={() => act({ type: 'giveup' })} onClose={() => setGiveup(false)}>
            {coop ? 'Ván kết thúc cho cả đội và từ bí mật sẽ được công bố.' : 'Bạn dừng đoán ván này.'}
          </ConfirmDialog>
        )}
      </div>

      <GameInfo>
        {g && !coop && g.others.length > 0 && <Others g={g} />}
        <Wins wins={s.wins} me={user.id} />
        <History history={s.history} me={user.id} />
        <Rules s={s} />
      </GameInfo>
    </div>
  );
}

function Setup({ s, canEdit, act }: { s: WordGuessView; canEdit: boolean; act: Act }) {
  const o = s.options;
  return (
    <div className="wg-setup">
      <div className="wc-big">🔠 Đoán chữ</div>
      <div className="muted">Đoán từ <b>2 chữ</b> trong <b>6 lượt</b>. Mỗi chữ được chấm theo <b>âm đầu · vần · thanh</b>.</div>
      <Example />
      {canEdit ? (
        <div className="wg-modes">
          <div className="seg">
            <button type="button" className={o.mode === 'race' ? 'active' : ''} onClick={() => act({ type: 'setMode', mode: 'race' })}><Swords size={15} aria-hidden /> Đua — mỗi người một bàn</button>
            <button type="button" className={o.mode === 'coop' ? 'active' : ''} onClick={() => act({ type: 'setMode', mode: 'coop' })}><Users size={15} aria-hidden /> Cùng đoán — chung một bàn</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={o.daily} onChange={(e) => act({ type: 'setMode', daily: e.target.checked })} />
            Từ của ngày (mọi người cùng một từ, mỗi ngày đổi một lần)
          </label>
        </div>
      ) : (
        <div className="muted small">{o.mode === 'coop' ? 'Cùng đoán' : 'Đua'}{o.daily ? ' · Từ của ngày' : ''}</div>
      )}
      <div className="qz-seated">
        {s.seats.length === 0 ? <span className="muted small">Chưa có ai ngồi — bấm "Vào chơi"</span> : s.seats.map((p) => (
          <span key={p.id} className={`qz-chip ${s.ready.includes(p.id) ? 'ready' : ''}`}>{s.ready.includes(p.id) && <Check size={12} aria-hidden />}{p.name}</span>
        ))}
      </div>
    </div>
  );
}

/** Ví dụ chấm điểm cho người mới. */
function Example() {
  // Chấm bằng đúng hàm của trò chơi để ví dụ luôn khớp luật: hoa → h🟩 oa⬛ ngang🟨 · súng → s🟩 ung⬛ sắc⬛
  const secret = 'học sinh', guess = 'hoa súng';
  return (
    <div className="wg-example">
      <div className="small muted">Ví dụ: từ bí mật <b>"{secret}"</b>, bạn đoán <b>"{guess}"</b></div>
      <Row guess={{ text: guess, marks: scoreGuess(secret, guess) }} />
      <div className="small muted wg-legend">
        <span><i className="wg-dot g" /> đúng chỗ</span>
        <span><i className="wg-dot y" /> có ở chữ kia</span>
        <span><i className="wg-dot x" /> không có</span>
      </div>
    </div>
  );
}

function Board({ board, max, showBy }: { board: GuessBoardView | null; max: number; showBy: boolean }) {
  const rows: (GuessView | null)[] = [];
  for (let i = 0; i < max; i++) rows.push(board?.guesses[i] || null);
  return (
    <div className="wg-board" aria-label="Bàn đoán">
      {rows.map((guess, i) => <Row key={i} guess={guess} showBy={showBy} />)}
    </div>
  );
}

function Row({ guess, showBy = false }: { guess: { text?: string; marks: Marks[]; name?: string } | null; showBy?: boolean }) {
  if (!guess) {
    return (
      <div className="wg-row blank">
        <div className="wg-tile" /><div className="wg-tile" />
      </div>
    );
  }
  const parts = guess.text ? splitWord(guess.text) : null;
  const syl = guess.text ? guess.text.split(' ') : [];
  return (
    <div className="wg-row" title={guess.name ? `${guess.name} đoán` : undefined}>
      {guess.marks.map((m, i) => (
        <div key={i} className={`wg-tile ${PARTS.every((p) => m[p] === 'g') ? 'solved' : ''}`}>
          <div className="wg-syl">{syl[i]}</div>
          <div className="wg-parts">
            {PARTS.map((p) => (
              <span key={p} className={`wg-part ${m[p]}`} title={`${PART_NAMES[p]}: ${parts ? partLabel(p, parts[i][p]) : ''}`}>
                {parts ? partLabel(p, parts[i][p]) : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
      {showBy && guess.name && <span className="wg-by small muted">{guess.name}</span>}
    </div>
  );
}

function GuessInput({ act, count, max }: { act: Act; count: number; max: number }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, [count]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim().replace(/\s+/g, ' ');
    if (!t || busy) return;
    setBusy(true);
    const res = await act({ type: 'guess', text: t });
    setBusy(false);
    if (res) setText('');
    ref.current?.focus();
  };
  return (
    <form className="wc-input" onSubmit={submit}>
      <input ref={ref} autoFocus value={text} maxLength={24} disabled={busy} onChange={(e) => setText(e.target.value)}
        placeholder={`Lượt ${count + 1}/${max}: gõ từ 2 chữ, vd "học sinh"`} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="Từ đoán" />
      <button className="btn primary" disabled={!text.trim() || busy}>Đoán ↵</button>
    </form>
  );
}

/** Tổng hợp các âm đầu / vần / thanh đã thử, tô theo kết quả tốt nhất. */
function Tracker({ guesses }: { guesses: GuessView[] }) {
  const seen = useMemo(() => {
    const out: Record<Part, Map<string | number, Mark>> = { onset: new Map(), rhyme: new Map(), tone: new Map() };
    for (const gs of guesses) {
      if (!gs.text) continue;
      splitWord(gs.text).forEach((sp, i) => {
        for (const p of PARTS) {
          const k = sp[p];
          const v = gs.marks[i][p];
          const prev = out[p].get(k);
          if (!prev || RANK[v] > RANK[prev]) out[p].set(k, v);
        }
      });
    }
    return out;
  }, [guesses]);
  if (!guesses.length) return null;
  return (
    <div className="wg-tracker">
      {PARTS.map((p) => (
        <div key={p} className="wg-track">
          <span className="small muted">{PART_NAMES[p]}</span>
          <div className="wg-chips">
            {(p === 'tone' ? TONE_NAMES.map((_, i) => i) : [...seen[p].keys()]).map((k) => (
              <span key={k} className={`wg-chip ${seen[p].get(k) || ''}`}>{partLabel(p, k)}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function resultTitle(g: WordGuessGameView, me: string | null) {
  const r = g.result;
  if (!r) return '';
  if ('solved' in r) return r.solved ? `🎉 Cả đội đoán đúng sau ${r.guesses} lượt!` : 'Chưa đoán ra rồi!';
  if (!r.winner) return 'Không ai đoán ra!';
  if (r.winner === me) return r.ranking.length > 1 ? '🏆 Bạn thắng!' : `🎉 Bạn đoán đúng sau ${g.mine?.count} lượt!`;
  return `🏆 ${g.others.find((b) => b.id === r.winner)?.name || '?'} thắng`;
}

function Result({ g, me }: { g: WordGuessGameView; me: string | null }) {
  const title = resultTitle(g, me);
  return (
    <div className="wg-result">
      <div className="wc-big">{title}</div>
      <div>Từ bí mật: <b className="wg-secret">{g.secret}</b></div>
      {g.daily && <div className="muted small">Từ của ngày — ngày mai có từ mới.</div>}
    </div>
  );
}

function Others({ g }: { g: WordGuessGameView }) {
  return (
    <div className="panel">
      <h4>Bàn của mọi người</h4>
      <div className="wg-others">
        {g.others.map((b) => (
          <div key={b.id} className="wg-other">
            <div className="small"><b>{b.name}</b> <span className="muted">· {b.solved ? `✓ ${b.count} lượt` : b.gaveUp ? 'chịu thua' : b.left ? 'đã rời' : b.done ? 'hết lượt' : `${b.count}/${g.maxGuesses}`}</span></div>
            <div className="wg-minigrid">
              {b.guesses.map((gs, i) => (
                <div key={i} className="wg-minirow" title={gs.text || undefined}>
                  {gs.marks.flatMap((m, j) => PARTS.map((p) => <i key={`${j}${p}`} className={`wg-dot ${m[p]}`} />))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Wins({ wins, me }: { wins: WordGuessScoreView[]; me: string }) {
  if (!wins.length) return null;
  return (
    <div className="panel">
      <h4>Bảng thành tích</h4>
      <table className="sb-table">
        <thead><tr><th>#</th><th>Người chơi</th><th>Ván</th><th>Đoán ra</th><th>Thắng</th></tr></thead>
        <tbody>
          {wins.map((w, i) => (
            <tr key={w.id} className={w.id === me ? 'me' : ''}>
              <td>{i === 0 && w.wins > 0 ? '🏆' : i + 1}</td>
              <td className="sb-name">{w.name}</td>
              <td>{w.games}</td>
              <td>{w.solved}</td>
              <td><b>{w.wins}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ history }: { history: WordGuessHistoryView[]; me?: string }) {
  if (!history.length) return null;
  return (
    <div className="panel">
      <h4>Các ván trước</h4>
      {history.map((h) => (
        <div key={h.no} className="wg-hist small">
          <b>Ván {h.no}</b> · <span className="wg-secret">{h.secret}</span> · {h.mode === 'coop' ? 'Cùng đoán' : 'Đua'} · {h.solved ? <Trophy size={12} aria-label="đoán ra" /> : 'không ai ra'}
          <span className="muted"> · {fmtTime(h.endedAt)}</span>
          {h.mode === 'race' && <div className="muted">{h.ranking.map((p) => `${p.name} ${p.solved ? `✓${p.guesses}` : '✗'}`).join(' · ')}</div>}
        </div>
      ))}
    </div>
  );
}

function Rules({ s }: { s: WordGuessView }) {
  return (
    <div className="panel small muted wc-rules">
      <b>Luật chơi</b>
      <ul>
        <li>Đoán một từ tiếng Việt gồm <b>2 chữ</b> trong 6 lượt, {s.options.minutes} phút. Từ đoán phải có trong từ điển.</li>
        <li>Mỗi chữ tách làm 3 phần: <b>âm đầu</b> (h, ng, tr…), <b>vần</b> (oc, inh, ương…), <b>thanh</b> (ngang, huyền, sắc, hỏi, ngã, nặng).</li>
        <li>🟩 đúng phần đó ở đúng chữ · 🟨 phần đó có ở chữ còn lại · ⬛ không có.</li>
        <li><b>Đua:</b> cùng một từ, ai đoán ra ít lượt nhất thắng (bằng lượt thì ai nhanh hơn). Chỉ thấy màu ô của người khác, không thấy chữ.</li>
        <li><b>Cùng đoán:</b> cả phòng chung 6 lượt, ai cũng được đoán.</li>
        <li>Kho đáp án có {s.answers} từ thông dụng.</li>
      </ul>
    </div>
  );
}
