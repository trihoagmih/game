import { useEffect, useRef, useState } from 'react';
import { Flag, ThumbsDown, Timer, ChevronRight, Trophy, AlertTriangle, X } from 'lucide-react';
import { useRoomApp } from '../store.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { Identity } from '@game/shared/contracts';
import type { WordChainGameView, WordChainHistoryView, WordChainScoreView, WordChainView } from '@game/shared/views';
import type { FormEvent } from 'react';

type Act = AppContextValue['act'];
type FlowWord = WordChainHistoryView['words'][number];
import GameInfo from '../components/GameInfo.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import { useCountdown } from '../hooks.js';
import { fmtTime } from '../format.js';
import BotPicker, { canManageBots } from '../components/BotPicker.js';
import './WordChainGame.css';

const MAX_BOTS = 3;

export default function WordChainGame({ room, state: s }: { room: ClientRoom; state: WordChainView }) {
  const { act, call, user } = useRoomApp();
  const [giveup, setGiveup] = useState(false);
  const g = s.game;
  const me = s.myId;
  const playing = s.status === 'playing';
  const myTurn = playing && g?.currentId === me;
  const timeLeft = useCountdown(s.turnLeft, room.receivedAt, playing);
  const last = g?.chain[g.chain.length - 1];
  const meInGame = g?.players.find((p) => p.id === me);
  const canObject = playing && last && meInGame && !meInGame.out && last.by !== me;
  const objected = !!me && !!g?.objections.includes(me);
  const nameOf = (id: string | null) => g?.players.find((p) => p.id === id)?.name || s.seats.find((x) => x.id === id)?.name || '?';
  const manageBots = !playing && canManageBots(room, user, !!me);
  const botCount = s.seats.filter((x) => x.bot).length;
  const canAddBot = manageBots && s.seats.length < s.options.maxSeats && botCount < MAX_BOTS;
  const over = s.status === 'over' && !!g?.result;
  const winnerId = g?.result?.winner;

  return (
    <div className="wc">
      <div className="wc-main">
        <GameOverDialog over={over} icon={<Trophy size={26} />}
          title={winnerId ? <>{winnerId === me ? 'Bạn' : nameOf(winnerId)} thắng!</> : 'Hòa!'}
          detail={g?.result?.reason === 'deadEnd'
            ? `Nối “${g.result.word}” — không còn từ nào bắt đầu bằng “${g.result.word?.split(' ')[1]}”, thắng luôn!`
            : `Cả bàn nối được ${g?.total ?? 0} từ`}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!me}
          seatBtn={me ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}>
          <GoRanking me={me} rows={g?.result?.ranking.map((id) => ({ id, name: nameOf(id) }))} />
        </GameOverDialog>
        <PlayerRow s={s} timeLeft={timeLeft} ownerId={room.ownerId} onRemoveBot={manageBots ? (id) => act({ type: 'removeBot', id }) : null} />

        <div className={`panel wc-stage ${myTurn ? 'my-turn' : ''}`}>
          {!g || s.status === 'waiting' ? (
            <div className="wc-wait">
              <div className="wc-big">🔤 Nối từ</div>
              <div className="muted">
                {s.seats.length < 2 ? 'Cần ít nhất 2 người chơi… hoặc bấm “Chơi với máy” bên dưới' : 'Chờ mọi người sẵn sàng, chủ phòng bấm Bắt đầu'}
              </div>
            </div>
          ) : (
            <>
              {last ? (
                <div className="wc-word">
                  <span className="wc-syl">{last.syllables[0]}</span>{' '}
                  <span className="wc-syl key">{last.syllables[1]}</span>
                  <div className="muted small">#{g.total} · {last.name}{last.known === false && <span className="wf-flag-text"> · <AlertTriangle size={12} aria-hidden /> không có trong từ điển</span>}</div>
                </div>
              ) : (
                <div className="wc-word empty">
                  <span className="muted">Chưa có từ nào</span>
                </div>
              )}

              {s.status === 'over' && g.result ? (
                <div className="wc-result">
                  <div className="wc-big">🏆 {g.result.winner ? `${nameOf(g.result.winner)} thắng!` : 'Hòa'}</div>
                  {g.result.reason === 'deadEnd' && (
                    <div className="wc-deadend">🎯 Nối “{g.result.word}” — từ điển không còn từ nào bắt đầu bằng “{g.result.word?.split(' ')[1]}”, thắng luôn!</div>
                  )}
                  <div className="muted small">
                    Xếp hạng: {g.result.ranking.map((id, i) => `${i + 1}. ${nameOf(id)}`).join(' · ')} — {g.total} từ
                  </div>
                </div>
              ) : (
                <div className="wc-turn">
                  {/* Ai tới lượt đã hiện ở thanh báo lượt phía trên → ở đây chỉ nói cần nối gì */}
                  {g.required ? <>Bắt đầu bằng <b className="wc-req">{g.required}</b></> : <>{myTurn ? 'Bạn' : nameOf(g.currentId)} ra từ đầu tiên{s.firstMinNext > 0 && <span className="muted small wc-first-hint">Chọn từ dễ nối: chữ cuối phải có ≥ {s.firstMinNext} từ nối tiếp</span>}</>}
                  <span className={`wc-time ${timeLeft < 5000 ? 'low' : ''}`}><Timer size={14} aria-hidden /> {Math.ceil(timeLeft / 1000)}s</span>
                  <div className="timebar"><div style={{ width: `${(timeLeft / s.turnTotal) * 100}%` }} /></div>
                </div>
              )}

              {/* Các ô dưới đây luôn chiếm chỗ cố định để khung không co giãn giữa các lượt */}
              <div className="wc-input-slot">
                {myTurn ? <WordInput required={g.required} act={act} />
                  : playing && <span className="muted small">Chờ {nameOf(g.currentId)} nối từ…</span>}
              </div>

              <div className="wc-object-slot">
              {canObject && (
                <button className={`btn sm ${objected ? 'danger' : ''}`} onClick={() => act({ type: 'object' })}
                  title="Từ vô nghĩa? Quá nửa số người còn lại phản đối thì từ bị gỡ">
                  <ThumbsDown size={16} aria-hidden /> {objected ? 'Rút phản đối' : `"${last.text}" vô nghĩa`} ({g.objections.length}/{g.objectionsNeeded})
                </button>
              )}
              {!canObject && playing && last && g.objections.length > 0 && (
                <div className="muted small">Đang có {g.objections.length}/{g.objectionsNeeded} phiếu phản đối "{last.text}"</div>
              )}
              </div>
            </>
          )}
        </div>

        {over ? (
          canAddBot && <div className="board-actions"><BotPicker label={botCount ? 'Thêm máy' : 'Chơi với máy'} onPick={(level) => act({ type: 'addBot', level })} /></div>
        ) : <div className="board-actions">
          {me ? (
            <>
              {!playing && (
                <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated
                  startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />
              )}
              {playing && meInGame && !meInGame.out && (
                <button className="btn danger" onClick={() => setGiveup(true)}><Flag size={16} aria-hidden /> Chịu thua</button>
              )}
              {canAddBot && <BotPicker label={botCount ? 'Thêm máy' : 'Chơi với máy'} onPick={(level) => act({ type: 'addBot', level })} />}
              {!playing && <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>}
            </>
          ) : (
            <>
              <span className="muted small ba-note">
                Bạn đang xem.{' '}
                {!playing && s.seats.length < s.options.maxSeats && (
                  <button className="btn primary sm" onClick={() => call('room:sit', {})}>Vào chơi</button>
                )}
              </span>
              {!playing && <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={false}
                startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />}
            </>
          )}
          {!me && canAddBot && <BotPicker label="Thêm máy" onPick={(level) => act({ type: 'addBot', level })} />}
        </div>}
        {giveup && (
          <ConfirmDialog title="Chịu thua ván này?" danger okLabel="Chịu thua" icon={<Flag size={22} />}
            onOk={() => act({ type: 'giveup' })} onClose={() => setGiveup(false)}>
            Bạn sẽ bị loại khỏi ván này.
          </ConfirmDialog>
        )}
      </div>

      <GameInfo>
        {g && <Chain g={g} history={s.history || []} me={me} />}
        <Wins wins={s.wins} me={user.id} />
        <div className="panel small muted wc-rules">
          <b>Luật chơi</b>
          <ul>
            <li>Mỗi từ gồm <b>2 chữ</b>, chữ đầu phải trùng chữ cuối của từ trước: <i>đắng cay → cay nghiệt → nghiệt ngã</i>.</li>
            <li>Không lặp lại từ đã dùng trong ván.{s.options.dictionary && (s.options.strict
              ? ' Từ phải có trong từ điển tiếng Việt (~62.000 từ 2 chữ).'
              : ' Mỗi chữ phải là tiếng Việt; từ không có trong từ điển bị gắn cờ ⚠ để mọi người cân nhắc phản đối.')}</li>
            <li>Mỗi lượt {s.options.turnSeconds} giây. Hết giờ mất 1 mạng (có {s.options.lives} mạng), hết mạng bị loại.</li>
            <li>Từ vô nghĩa? Bấm <b>vô nghĩa</b>: quá nửa số người còn lại phản đối thì từ bị gỡ, người đó nối lại.</li>
            {s.options.dictionary && <li>Từ mở đầu phải <b>dễ nối</b>: chữ cuối có ít nhất {s.firstMinNext} từ nối tiếp trong từ điển.</li>}
            {s.options.dictionary && <li>Nối một từ mà từ điển <b>không còn từ nào nối tiếp</b> (vd: <i>ao chuôm</i>) → <b>thắng luôn</b>.</li>}
            <li>Người cuối cùng còn lại thắng.</li>
            <li>Chơi với máy (tối đa {MAX_BOTS}): máy <b>Dễ</b> hay bí, máy <b>Vừa</b> nối ngẫu nhiên, máy <b>Khó</b> chọn từ hiểm khó nối tiếp. Máy không bỏ phiếu phản đối.</li>
          </ul>
        </div>
      </GameInfo>
    </div>
  );
}

function WordInput({ required, act }: { required: string | null; act: Act }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(''); ref.current?.focus(); }, [required]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const res = await act({ type: 'word', text: required ? `${required} ${t}` : t });
    setBusy(false);
    if (!res) ref.current?.focus(); // lỗi: giữ chữ để sửa
  };

  return (
    <form className="wc-input" onSubmit={submit}>
      {required && <span className="wc-prefix">{required}</span>}
      <input ref={ref} autoFocus value={text} maxLength={required ? 12 : 24} disabled={busy} aria-label={required ? `Chữ thứ hai sau "${required}"` : 'Từ đầu tiên'}
        onChange={(e) => setText(required ? e.target.value.replace(/\s/g, '') : e.target.value)}
        placeholder={required ? 'chữ thứ hai…' : 'từ đầu tiên, vd: học tập'} autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button className="btn primary" disabled={!text.trim() || busy}>Nối ↵</button>
    </form>
  );
}

function PlayerRow({ s, timeLeft, ownerId, onRemoveBot }: { s: WordChainView; timeLeft: number; ownerId: string; onRemoveBot: ((id: string) => void) | null }) {
  const g = s.game;
  const list = g && s.status !== 'waiting' ? g.players : s.seats.map((x) => ({ ...x, lives: s.options.lives, out: false, words: 0 }));
  return (
    <div className="wc-players">
      {list.map((p) => {
        const turn = s.status === 'playing' && g?.currentId === p.id;
        return (
          <div key={p.id} className={`wc-player ${turn ? 'turn' : ''} ${p.out ? 'out' : ''} ${p.id === s.myId ? 'me' : ''}`}>
            <div className="wc-pname">
              {p.name}{p.id === s.myId && <span className="muted"> (bạn)</span>}
              {p.bot && onRemoveBot && (
                <button className="icon-btn wc-bot-x" onClick={() => onRemoveBot(p.id)} title="Bỏ máy khỏi bàn" aria-label={`Bỏ ${p.name}`}><X size={14} aria-hidden /></button>
              )}
            </div>
            <div className="small">
              {p.out ? <span className="muted">Bị loại</span> : <span className="wc-lives">{'♥'.repeat(p.lives)}</span>}
              {g && s.status !== 'waiting' && <span className="muted"> · {p.words} từ</span>}
              {s.status !== 'playing' && <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />}
            </div>
            {turn && <div className="timebar"><div style={{ width: `${(timeLeft / s.turnTotal) * 100}%` }} /></div>}
          </div>
        );
      })}
      {list.length === 0 && <div className="muted small">Chưa có ai ngồi</div>}
    </div>
  );
}

// Mỗi người chơi một màu để nhìn là biết ai nối từ nào
const PLAYER_COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
const colorOf = (players: Identity[], id: string) => PLAYER_COLORS[Math.max(0, players.findIndex((p) => p.id === id)) % PLAYER_COLORS.length];

/**
 * Chuỗi từ hiển thị nối liền từ trái sang phải theo thứ tự nối.
 * Chữ nối (chữ đầu của từ = chữ cuối của từ trước) được tô sáng để thấy mạch nối.
 */
function WordFlow({ words, players, me, offset = 0, follow = false }: { words: FlowWord[]; players: Identity[]; me: string | null; offset?: number; follow?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => { if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [follow, words.length]);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name || '?';
  return (
    <ol className="wf" ref={ref} aria-label="Chuỗi từ theo thứ tự nối">
      {words.map((w, i) => (
        <li key={offset + i} className={`wf-item ${w.by === me ? 'mine' : ''}`} style={{ '--pc': colorOf(players, w.by) }}
          title={`${offset + i + 1}. ${w.s.join(' ')} — ${nameOf(w.by)}`}>
          {offset + i > 0 && <ChevronRight size={12} className="wf-arrow" aria-hidden />}
          <span className="wf-n">{offset + i + 1}</span>
          <span className="wf-word">
            <span className={offset + i > 0 ? 'wf-link' : ''}>{w.s[0]}</span> {w.s[1]}
            {w.known === false && <AlertTriangle size={12} className="wf-flag" aria-label="không có trong từ điển" />}
          </span>
          <span className="sr-only"> — {nameOf(w.by)}</span>
        </li>
      ))}
    </ol>
  );
}

function Legend({ players, me }: { players: Identity[]; me: string | null }) {
  return (
    <div className="wf-legend">
      {players.map((p) => (
        <span key={p.id} className="wf-legend-item" style={{ '--pc': colorOf(players, p.id) }}>
          <span className="wf-dot" aria-hidden />{p.name}{p.id === me && ' (bạn)'}
        </span>
      ))}
    </div>
  );
}

function Chain({ g, history, me }: { g: WordChainGameView; history: WordChainHistoryView[]; me: string | null }) {
  const [tab, setTab] = useState('now');
  const words = g.chain.map((w) => ({ s: w.syllables, by: w.by, known: w.known }));
  return (
    <div className="panel wc-chain">
      <div className="sb-head">
        <h4>Chuỗi từ</h4>
        <div className="tabs sm" role="tablist">
          <button role="tab" aria-selected={tab === 'now'} className={`tab ${tab === 'now' ? 'active' : ''}`} onClick={() => setTab('now')}>
            Ván này <span className="tab-count">{g.total}</span>
          </button>
          <button role="tab" aria-selected={tab === 'past'} className={`tab ${tab === 'past' ? 'active' : ''}`} onClick={() => setTab('past')}>
            Các ván trước <span className="tab-count">{history.length}</span>
          </button>
        </div>
      </div>
      {tab === 'now' ? (
        <>
          <Legend players={g.players} me={me} />
          {words.length === 0 ? <div className="wf-empty muted small">Chưa có từ nào — từ đầu tiên sẽ hiện ở đây</div>
            : <WordFlow words={words} players={g.players} me={me} offset={g.total - words.length} follow />}
        </>
      ) : (
        <div className="wf-history">
          {history.length === 0 ? <div className="wf-empty muted small">Chưa có ván nào kết thúc</div> : history.map((h) => {
            const winner = h.players.find((p) => p.id === h.winner);
            return (
              <details key={h.no} className="wf-game">
                <summary>
                  <b>Ván {h.no}</b>
                  <span className="wf-meta">
                    {winner ? <><Trophy size={13} aria-hidden /> {winner.name}</> : 'Không ai thắng'} · {h.words.length} từ · {fmtTime(h.endedAt)}
                  </span>
                </summary>
                <Legend players={h.players} me={me} />
                {h.words.length ? <WordFlow words={h.words} players={h.players} me={me} /> : <div className="muted small">Không có từ nào</div>}
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Wins({ wins, me }: { wins: WordChainScoreView[]; me: string }) {
  if (!wins.length) return null;
  return (
    <div className="panel">
      <h4>Bảng thắng</h4>
      <table className="sb-table">
        <thead><tr><th>#</th><th>Người chơi</th><th>Ván</th><th>Thắng</th></tr></thead>
        <tbody>
          {wins.map((w, i) => (
            <tr key={w.id} className={w.id === me ? 'me' : ''}>
              <td>{i === 0 && w.wins > 0 ? '🏆' : i + 1}</td>
              <td className="sb-name">{w.name}</td>
              <td>{w.games}</td>
              <td><b>{w.wins}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
