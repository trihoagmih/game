import { useState } from 'react';
import { Check, X, Timer, Trophy, Flame, ChevronRight, BookOpen, PencilLine, Clock } from 'lucide-react';
import { QUIZ_CATEGORIES } from '@game/shared/quiz';
import { useApp, useRoomApp } from '../store.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { GameAction } from '@game/shared/contracts';
import type { QuizGameView, QuizHistoryView, QuizScoreView, QuizView } from '@game/shared/views';

type Act = AppContextValue['act'];
import { useCountdown, useHotkeys } from '../hooks.js';
import { fmtTime } from '../format.js';
import GameInfo from '../components/GameInfo.js';
import StartBar from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import QuizEditor from '../components/QuizEditor.js';
import './QuizGame.css';

// 4 màu + hình cho 4 đáp án (người mù màu vẫn phân biệt được bằng hình)
const SHAPES = [['▲', 'qz-red'], ['◆', 'qz-blue'], ['●', 'qz-yellow'], ['■', 'qz-green']];

export default function QuizGame({ room, state: s }: { room: ClientRoom; state: QuizView }) {
  const { act, call, user } = useRoomApp();
  const [editor, setEditor] = useState(false);
  const g = s.game;
  const me = s.myId;
  const playing = s.status === 'playing';
  const left = useCountdown(g?.timeLeft || 0, room.receivedAt, playing);
  const canEdit = !playing && (!!me || room.ownerId === user.id);
  const canNext = !!me || room.ownerId === user.id;
  // Phím tắt: 1–4 chọn đáp án, Enter / → sang câu tiếp khi đang xem đáp án
  const pick = (i: number) => () => {
    if (playing && g?.phase === 'question' && g.me && g.myChoice === null && i < (g.question?.choices.length || 0)) act({ type: 'answer', choice: i });
  };
  const next = () => { if (playing && g?.phase === 'reveal' && canNext) act({ type: 'next' }); };
  useHotkeys({ 1: pick(0), 2: pick(1), 3: pick(2), 4: pick(3), Enter: next, ArrowRight: next });

  const over = s.status === 'over' && !!g;
  const lb = g?.leaderboard || [];
  const solo = lb.length === 1;

  return (
    <div className="qz">
      <div className="qz-main">
        <GameOverDialog over={over} icon={<Trophy size={26} />}
          title={solo ? `${lb[0].score.toLocaleString('vi-VN')} điểm` : lb[0] ? <>{lb[0].id === me ? 'Bạn' : lb[0].name} thắng!</> : 'Hết ván!'}
          detail={solo ? `Đúng ${lb[0].correct}/${g?.total} câu` : g ? `${g.total} câu · ${g.title}` : null}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!me} min={1} reviewLabel="Xem kết quả"
          seatBtn={me ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}>
          {!solo && <GoRanking me={me} rows={lb.map((p) => ({ id: p.id, name: p.name, value: p.score.toLocaleString('vi-VN'), note: `đúng ${p.correct}/${g?.total}` }))} />}
        </GameOverDialog>
        {g && s.status !== 'waiting' && (
          <div className="qz-top">
            <span className="qz-progress">{g.phase === 'intro' ? 'Chuẩn bị' : `Câu ${Math.min(g.index + 1, g.total)}/${g.total}`}</span>
            <span className="muted small qz-title">{g.title}</span>
            {g.me && (
              <span className="qz-me">
                <b>{g.me.score.toLocaleString('vi-VN')}</b> điểm
                {g.me.streak >= 2 && <span className="qz-streak" title="Chuỗi trả lời đúng liên tiếp"><Flame size={14} aria-hidden /> {g.me.streak}</span>}
              </span>
            )}
          </div>
        )}

        <div className="panel qz-stage">
          {s.status === 'waiting' || !g ? (
            <Lobby s={s} room={room} canEdit={canEdit} onEdit={() => setEditor(true)} />
          ) : g.phase === 'intro' ? (
            <div className="qz-intro">
              <div className="muted">Câu hỏi đầu tiên sau</div>
              <div className="qz-count">{Math.max(1, Math.ceil(left / 1000))}</div>
              <div className="muted small">{g.total} câu · trả lời càng nhanh càng nhiều điểm</div>
            </div>
          ) : g.phase === 'over' ? (
            <Podium g={g} me={me} />
          ) : (
            <Question g={g} me={me} left={left} act={act} canNext={canNext} />
          )}
        </div>

        {!over && <div className="board-actions">
          {me ? (
            !playing && (
              <>
                <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated min={1}
                  startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />
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
            startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />}
        </div>}
      </div>

      <GameInfo>
        {g && <Leaderboard g={g} me={me} />}
        <Wins wins={s.wins} me={user.id} />
        <History history={s.history} me={user.id} />
        <div className="panel small muted wc-rules">
          <b>Luật chơi</b>
          <ul>
            <li>Mỗi câu có {s.options.seconds} giây. Chọn một đáp án — chỉ được chọn một lần.</li>
            <li>Đúng được tới <b>1.000 điểm</b>: trả lời càng nhanh càng nhiều điểm (chậm nhất vẫn được 500).</li>
            <li>Đúng liên tiếp được thưởng chuỗi 🔥: +100, +200 … tối đa +500 mỗi câu. Sai hoặc hết giờ là mất chuỗi.</li>
            <li>Bộ có sẵn ({s.bankSize} câu) lấy ngẫu nhiên, ít lặp lại trong phòng. Ai cũng có thể <b>tự soạn bộ câu hỏi</b> riêng.</li>
          </ul>
        </div>
      </GameInfo>

      {editor && <QuizEditor onClose={() => setEditor(false)} onLoad={(text) => act({ type: 'loadQuiz', text })} />}
    </div>
  );
}

function Lobby({ s, room, canEdit, onEdit }: { s: QuizView; room: ClientRoom; canEdit: boolean; onEdit: () => void }) {
  const { act } = useApp();
  const src = s.source;
  const o = s.options;
  const set = (patch: Omit<Extract<GameAction, { type: 'useBuiltin' }>, 'type'>) => act({ type: 'useBuiltin', ...patch });
  return (
    <div className="qz-lobby">
      <div className="wc-big">❓ Đố vui</div>
      <div className="qz-source">
        {src.type === 'custom' ? (
          <>
            <PencilLine size={18} aria-hidden />
            <div>
              <b>{src.title}</b>
              <div className="muted small">Bộ tự soạn của {src.by} · {src.count} câu · {o.seconds} giây/câu</div>
            </div>
          </>
        ) : (
          <>
            <BookOpen size={18} aria-hidden />
            <div>
              <b>Bộ câu hỏi có sẵn</b>
              <div className="muted small">{o.category === 'all' ? 'Tất cả chủ đề' : o.category} · {o.questions} câu ngẫu nhiên · {o.seconds} giây/câu</div>
            </div>
          </>
        )}
      </div>
      {canEdit && (
        <div className="qz-settings">
          {src.type === 'builtin' && (
            <>
              <label>
                <span className="small muted">Chủ đề</span>
                <select value={o.category} onChange={(e) => set({ category: e.target.value })}>
                  <option value="all">Tất cả chủ đề</option>
                  {QUIZ_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>
                <span className="small muted">Số câu</span>
                <select value={o.questions} onChange={(e) => set({ questions: Number(e.target.value) })}>
                  {[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n} câu</option>)}
                </select>
              </label>
            </>
          )}
          <label>
            <span className="small muted">Thời gian</span>
            <select value={o.seconds} onChange={(e) => act({ type: 'setSeconds', seconds: Number(e.target.value) })}>
              {[10, 15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{n} giây/câu</option>)}
            </select>
          </label>
          <div className="qz-src-btns">
            <button className="btn" onClick={onEdit}><PencilLine size={16} aria-hidden /> {src.type === 'custom' ? 'Đổi bộ tự soạn' : 'Bộ câu hỏi của tôi'}</button>
            {src.type === 'custom' && <button className="btn ghost" onClick={() => set({})}><BookOpen size={16} aria-hidden /> Dùng bộ có sẵn</button>}
          </div>
        </div>
      )}
      <div className="qz-seated">
        {s.seats.length === 0 ? <span className="muted small">Chưa có ai ngồi — bấm "Vào chơi"</span> : s.seats.map((p) => (
          <span key={p.id} className={`qz-chip ${s.ready.includes(p.id) ? 'ready' : ''}`}>{s.ready.includes(p.id) && <Check size={12} aria-hidden />}{p.name}</span>
        ))}
      </div>
      <div className="muted small">Chơi một mình hoặc cả phòng cùng thi: mọi người bấm Sẵn sàng, chủ phòng bấm Bắt đầu.</div>
    </div>
  );
}

function Question({ g, me, left, act, canNext }: { g: QuizGameView; me: string | null; left: number; act: Act; canNext: boolean }) {
  const q = g.question;
  const reveal = g.reveal;
  const total = g.totalMs;
  const answered = g.myChoice !== null;
  const canAnswer = g.phase === 'question' && !!g.me && !answered;
  const counts = reveal?.counts;
  const maxCount = counts ? Math.max(1, ...counts) : 1;
  const last = g.me?.last;
  if (!q) return null;
  const answerText = reveal ? q.choices[reveal.answer] : '';
  return (
    <div className="qz-q">
      {q.c && <div className="qz-cat small muted">{q.c}</div>}
      <h2 className="qz-text">{q.q}</h2>
      {g.phase === 'question' ? (
        <div className="qz-timer">
          <span className={`wc-time ${left < 5000 ? 'low' : ''}`}><Timer size={14} aria-hidden /> {Math.ceil(left / 1000)}s</span>
          <div className="timebar"><div style={{ width: `${(left / total) * 100}%` }} /></div>
        </div>
      ) : (
        <div className={`qz-verdict ${last ? (last.correct ? 'ok' : 'bad') : ''}`} role="status">
          {!g.me ? <>Đáp án đúng: <b>{answerText}</b></>
            : last?.correct ? <><Check size={18} aria-hidden /> Chính xác! <b>+{last.points}</b>{last.bonus > 0 && <span className="qz-bonus"> +{last.bonus} chuỗi 🔥</span>}</>
              : last?.answered ? <><X size={18} aria-hidden /> Sai rồi — đáp án là <b>{answerText}</b></>
                : <><Clock size={18} aria-hidden /> Hết giờ — đáp án là <b>{answerText}</b></>}
        </div>
      )}
      <div className={`qz-choices n${q.choices.length}`}>
        {q.choices.map((c, i) => {
          const [shape, color] = SHAPES[i];
          const cls = ['qz-choice', color];
          if (answered && g.myChoice === i) cls.push('picked');
          if (answered && g.myChoice !== i && !reveal) cls.push('dim');
          if (reveal) cls.push(i === reveal.answer ? 'right' : 'wrong');
          return (
            <button key={i} className={cls.join(' ')} disabled={!canAnswer} onClick={() => act({ type: 'answer', choice: i })}>
              <span className="qz-shape" aria-hidden>{shape}</span>
              <span className="qz-label">{c}</span>
              {reveal && <span className="qz-count-bar" style={{ '--w': `${(reveal.counts[i] / maxCount) * 100}%` }}><b>{reveal.counts[i]}</b></span>}
              {reveal && i === reveal.answer && <Check size={20} className="qz-tick" aria-label="Đáp án đúng" />}
            </button>
          );
        })}
      </div>
      {g.phase === 'question' && (
        <div className="muted small">{answered ? `Đã chọn — chờ mọi người (${g.answered}/${g.players})` : me ? `${g.answered}/${g.players} người đã trả lời` : `Bạn đang xem · ${g.answered}/${g.players} đã trả lời`}</div>
      )}
      {g.phase === 'reveal' && (
        <div className="qz-next">
          <MiniBoard g={g} me={me} />
          {canNext && (
            <button className="btn sm" onClick={() => act({ type: 'next' })}>
              {g.index + 1 < g.total ? 'Câu tiếp' : 'Xem kết quả'} <ChevronRight size={14} aria-hidden /> <span className="muted">{Math.ceil(left / 1000)}s</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MiniBoard({ g, me }: { g: QuizGameView; me: string | null }) {
  const top = g.leaderboard.slice(0, 5);
  return (
    <ol className="qz-mini">
      {top.map((p, i) => (
        <li key={p.id} className={p.id === me ? 'me' : ''}>
          <span className="qz-rank">{i + 1}</span>
          <span className="qz-name">{p.name}</span>
          {(p.gained ?? 0) > 0 && <span className="qz-gain">+{p.gained}</span>}
          <b>{p.score.toLocaleString('vi-VN')}</b>
        </li>
      ))}
    </ol>
  );
}

function Podium({ g, me }: { g: QuizGameView; me: string | null }) {
  const lb = g.leaderboard;
  const [p1, p2, p3] = lb;
  const mine = lb.findIndex((p) => p.id === me);
  return (
    <div className="qz-over">
      <div className="wc-big"><Trophy size={26} aria-hidden /> Kết quả</div>
      {lb.length > 1 ? (
        <div className="qz-podium">
          {([[p2, 2], [p1, 1], [p3, 3]] as const).map(([p, rank]) => p && (
            <div key={p.id} className={`qz-step s${rank} ${p.id === me ? 'me' : ''}`}>
              <div className="qz-pname">{p.name}</div>
              <div className="small">{p.score.toLocaleString('vi-VN')} điểm · {p.correct}/{g.total}</div>
              <div className="qz-block">{rank}</div>
            </div>
          ))}
        </div>
      ) : p1 && (
        <div className="qz-solo">
          <div className="qz-count">{p1.score.toLocaleString('vi-VN')}</div>
          <div>điểm · đúng <b>{p1.correct}/{g.total}</b> câu</div>
        </div>
      )}
      {mine >= 3 && <div className="muted">Bạn đứng thứ {mine + 1} với {lb[mine].score.toLocaleString('vi-VN')} điểm</div>}
    </div>
  );
}

function Leaderboard({ g, me }: { g: QuizGameView; me: string | null }) {
  return (
    <div className="panel">
      <h4>Bảng xếp hạng</h4>
      <table className="sb-table">
        <thead><tr><th>#</th><th>Người chơi</th><th>Đúng</th><th>Điểm</th></tr></thead>
        <tbody>
          {g.leaderboard.map((p, i) => (
            <tr key={p.id} className={p.id === me ? 'me' : ''}>
              <td>{i + 1}</td>
              <td className="sb-name">{p.name}{p.left && <span className="muted"> (đã rời)</span>}{p.streak >= 2 && <span className="qz-streak"> 🔥{p.streak}</span>}</td>
              <td>{p.correct}</td>
              <td><b>{p.score.toLocaleString('vi-VN')}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Wins({ wins, me }: { wins: QuizScoreView[]; me: string }) {
  if (!wins.length) return null;
  return (
    <div className="panel">
      <h4>Bảng thắng</h4>
      <table className="sb-table">
        <thead><tr><th>#</th><th>Người chơi</th><th>Ván</th><th>Thắng</th><th>Cao nhất</th></tr></thead>
        <tbody>
          {wins.map((w, i) => (
            <tr key={w.id} className={w.id === me ? 'me' : ''}>
              <td>{i === 0 && w.wins > 0 ? '🏆' : i + 1}</td>
              <td className="sb-name">{w.name}</td>
              <td>{w.games}</td>
              <td><b>{w.wins}</b></td>
              <td>{w.best.toLocaleString('vi-VN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ history, me }: { history: QuizHistoryView[]; me: string }) {
  if (!history.length) return null;
  return (
    <div className="panel">
      <h4>Các ván trước</h4>
      {history.map((h) => (
        <details key={h.no} className="wf-game">
          <summary>
            <b>Ván {h.no}</b>
            <span className="wf-meta">{h.ranking[0]?.name} · {h.ranking[0]?.score.toLocaleString('vi-VN')} điểm · {fmtTime(h.endedAt)}</span>
          </summary>
          <div className="muted small">{h.title} · {h.total} câu</div>
          <ol className="qz-mini">
            {h.ranking.map((p, i) => (
              <li key={p.id} className={p.id === me ? 'me' : ''}>
                <span className="qz-rank">{i + 1}</span><span className="qz-name">{p.name}</span>
                <span className="muted small">{p.correct}/{h.total}</span><b>{p.score.toLocaleString('vi-VN')}</b>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}
