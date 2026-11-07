import { useEffect, useRef, useState } from 'react';
import { Pencil, Timer, Check, Trophy, CircleStop } from 'lucide-react';
import { useRoomApp } from '../store.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { ScribbleView } from '@game/shared/views';
import type { FormEvent } from 'react';
import type { CanvasHandle } from './ScribbleCanvas.js';

type Act = AppContextValue['act'];
import GameInfo from '../components/GameInfo.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { useCountdown } from '../hooks.js';
import ScribbleCanvas from './ScribbleCanvas.js';
import DrawTools, { useDrawTools } from './DrawTools.js';
import './ScribbleGame.css';

export default function ScribbleGame({ room, state: s }: { room: ClientRoom; state: ScribbleView }) {
  const { act, call, user } = useRoomApp();
  const playing = s.status === 'playing';
  const me = s.myId;
  const isDrawer = playing && s.drawerId === user.id;
  const canDraw = isDrawer && s.phase === 'draw';
  const isOwner = room.ownerId === user.id;
  const timeLeft = useCountdown(s.phaseLeft, room.receivedAt, playing && !!s.phaseLeft);
  const nameOf = (id: string | null) => s.seats.find((x) => x.id === id)?.name || s.scores.find((x) => x.id === id)?.name || '?';
  const [stop, setStop] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const t = useDrawTools(canvas, canDraw);
  const over = s.status === 'over';
  const seatBtn = me ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
    : s.seats.length < s.options.maxSeats && (
      <button className="btn primary" onClick={() => call('room:sit', {})}>{playing ? 'Vào đoán cùng' : 'Vào chơi'}</button>
    );
  const winIds = s.last?.winners || [];
  const winTitle = winIds.length === 0 ? 'Hết ván!'
    : winIds.length > 1 ? `Đồng hạng nhất: ${winIds.map((id) => (id === user.id ? 'Bạn' : nameOf(id))).join(', ')}`
      : <>{winIds[0] === user.id ? 'Bạn' : nameOf(winIds[0])} thắng!</>;

  return (
    <div className="sc">
      <div className="sc-main">
        <GameOverDialog over={over} icon={<Trophy size={26} />}
          title={winTitle}
          detail={s.last ? `Ván ${s.last.no} kết thúc` : null}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!me} seatBtn={seatBtn}>
          <GoRanking me={user.id} rows={s.last?.ranking.map((r) => ({ id: r.id, name: r.name, value: r.score }))} />
        </GameOverDialog>
        <div className="panel sc-top">
          <span className="sc-round">{playing ? <>Vòng <b>{s.round}</b>/{s.options.rounds}</> : `Vẽ đoán · ${s.options.rounds} vòng`}</span>
          <WordLine s={s} isDrawer={isDrawer} />
          {playing && s.phaseLeft > 0 && (
            <span className={`sc-time ${s.phase === 'draw' && timeLeft < 10000 ? 'low' : ''}`}><Timer size={14} aria-hidden /> {Math.ceil(timeLeft / 1000)}s</span>
          )}
        </div>

        <div className="sc-board">
          <div className={`sc-stage ${canDraw ? 'my-turn' : ''}`}>
            <ScribbleCanvas ref={canvas} turn={s.turnNo} canDraw={canDraw} tool={t.tool} color={t.color} size={t.brush} />
            <StageOverlay s={s} isDrawer={isDrawer} nameOf={nameOf} act={act} />
          </div>
          {canDraw && <DrawTools t={t} canvas={canvas} />}
        </div>

        {!over && (
          <div className="board-actions">
            {!playing && <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!me} />}
            {seatBtn}
            {playing && isOwner && <button className="btn ghost" onClick={() => setStop(true)}><CircleStop size={14} aria-hidden /> Dừng ván</button>}
          </div>
        )}
      </div>

      <div className="sc-side">
        <Players s={s} ownerId={room.ownerId} me={user.id} />
        <Feed s={s} me={me} isDrawer={isDrawer} act={act} />
      </div>

      <GameInfo>
        <Wins wins={s.wins} me={user.id} />
        <div className="panel small muted wc-rules">
          <b>Luật chơi</b>
          <ul>
            <li>Mỗi vòng ai cũng được vẽ một lần. Người vẽ chọn 1 trong 3 từ rồi vẽ trong {s.options.drawSeconds} giây.</li>
            <li>Người khác gõ đoán ở ô <b>Đoán</b> — không cần gõ dấu. Sai 1 chữ cái sẽ được báo “gần đúng”.</li>
            <li>Đoán càng sớm càng nhiều điểm; người đoán trước được thêm. Người vẽ được {60} điểm cho mỗi người đoán đúng.</li>
            {s.options.hints && <li>Hết gần nửa thời gian, gợi ý sẽ lộ dần vài chữ cái.</li>}
            <li>Không được vẽ chữ, không nhắc đáp án trong khung chat. Sau {s.options.rounds} vòng, ai nhiều điểm nhất thắng.</li>
          </ul>
        </div>
      </GameInfo>

      {stop && (
        <ConfirmDialog title="Dừng ván này?" danger okLabel="Dừng ván" onOk={() => act({ type: 'stop' })} onClose={() => setStop(false)}>
          Ván kết thúc ngay và xếp hạng theo điểm hiện tại.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Từ đang vẽ: người vẽ / người đã đoán đúng thấy cả từ; người khác thấy ô trống và gợi ý. */
function WordLine({ s, isDrawer }: { s: ScribbleView; isDrawer: boolean }) {
  if (s.status !== 'playing' || !s.mask) {
    return <span className="sc-word muted">{s.status === 'playing' && s.phase === 'choose' ? 'Đang chọn từ…' : ''}</span>;
  }
  if (s.word) {
    return <span className="sc-word known" aria-label={`Từ: ${s.word}`}>{isDrawer ? 'Vẽ: ' : ''}<b>{s.word}</b></span>;
  }
  const parts = s.mask.split(' ');
  return (
    <span className="sc-word" aria-label={`Từ gồm ${parts.map((p) => p.length).join(', ')} chữ cái`}>
      {parts.map((p, i) => (
        <span key={i} className="sc-mask-part">
          {[...p].map((ch, j) => <span key={j} className={`sc-letter ${ch === '_' ? '' : 'hint'}`}>{ch === '_' ? '' : ch}</span>)}
          <sub>{p.length}</sub>
        </span>
      ))}
    </span>
  );
}

/** Lớp phủ trên khung vẽ: chờ bắt đầu · chọn từ · đáp án sau lượt · kết quả ván. */
function StageOverlay({ s, isDrawer, nameOf, act }: { s: ScribbleView; isDrawer: boolean; nameOf: (id: string | null) => string; act: Act }) {
  if (s.status === 'playing' && s.phase === 'draw') return null;
  let body;
  if (s.status === 'playing' && s.phase === 'choose') {
    body = isDrawer && s.choices ? (
      <>
        <div className="sc-ov-title">Chọn một từ để vẽ</div>
        <div className="sc-choices">
          {s.choices.map((w, i) => <button key={w} className="btn cta" onClick={() => act({ type: 'choose', index: i })}>{w}</button>)}
        </div>
      </>
    ) : <div className="sc-ov-title"><Pencil size={18} aria-hidden /> {nameOf(s.drawerId)} đang chọn từ…</div>;
  } else if (s.status === 'playing' && s.phase === 'reveal') {
    const gains = s.turnGains || { drawer: 0, guessers: {} };
    const list = Object.entries(gains.guessers as Record<string, number>);
    body = (
      <>
        <div className="sc-ov-sub">Đáp án</div>
        <div className="sc-ov-word">{s.word}</div>
        <div className="sc-gains">
          {list.length === 0 ? <span className="muted">Không ai đoán được</span> : list.map(([id, p]) => <span key={id}>{nameOf(id)} <b>+{p}</b></span>)}
          {gains.drawer > 0 && <span>✏️ {nameOf(s.drawerId)} <b>+{gains.drawer}</b></span>}
        </div>
      </>
    );
  } else if (s.status === 'over' && s.last) {
    const top = s.last.ranking.slice(0, 3);
    body = (
      <>
        <div className="sc-ov-title"><Trophy size={20} aria-hidden /> Ván {s.last.no} kết thúc</div>
        <ol className="sc-podium">
          {top.map((r, i) => <li key={r.id} className={`p${i + 1}`}><span>{['🥇', '🥈', '🥉'][i]}</span> {r.name} <b>{r.score}</b></li>)}
        </ol>
      </>
    );
  } else {
    body = (
      <>
        <div className="sc-ov-title">🎨 Vẽ đoán</div>
        <div className="muted small">{s.seats.length < 2 ? 'Cần ít nhất 2 người chơi…' : 'Chờ mọi người sẵn sàng, chủ phòng bấm Bắt đầu'}</div>
      </>
    );
  }
  return <div className="sc-overlay" role="status">{body}</div>;
}

function Players({ s, ownerId, me }: { s: ScribbleView; ownerId: string; me: string }) {
  const playing = s.status === 'playing';
  const score = new Map(s.scores.map((x) => [x.id, x.score]));
  const list = [...s.seats].map((x) => ({ ...x, score: score.get(x.id) || 0 }));
  if (playing || s.status === 'over') list.sort((a, b) => b.score - a.score);
  return (
    <ol className="panel sc-players" aria-label="Người chơi">
      {list.map((p, i) => {
        const drawing = playing && p.id === s.drawerId;
        const guessed = s.guessed.includes(p.id);
        return (
          <li key={p.id} className={`${drawing ? 'drawing' : ''} ${guessed ? 'guessed' : ''} ${p.id === me ? 'me' : ''}`}>
            <span className="sc-rank">{s.status === 'waiting' ? '' : `#${i + 1}`}</span>
            <span className="sc-pname">{p.name}{p.id === me && <span className="muted"> (bạn)</span>}
              {!playing && <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />}
            </span>
            {drawing && <Pencil size={14} className="sc-pen" aria-label="đang vẽ" />}
            {guessed && <Check size={14} className="sc-ok" aria-label="đã đoán đúng" />}
            {s.status !== 'waiting' && <b className="sc-score">{p.score}</b>}
          </li>
        );
      })}
      {list.length === 0 && <li className="muted small">Chưa có ai ngồi</li>}
    </ol>
  );
}

function Feed({ s, me, isDrawer, act }: { s: ScribbleView; me: string | null; isDrawer: boolean; act: Act }) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const last = s.feed[s.feed.length - 1];
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [last?.n]);
  const guessed = !!me && s.guessed.includes(me);
  const canGuess = s.status === 'playing' && s.phase === 'draw' && !!me && !isDrawer && !guessed;
  useEffect(() => {
    if (canGuess && window.matchMedia?.('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, [canGuess, s.turnNo]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !canGuess) return;
    setText('');
    act({ type: 'guess', text: t });
  };
  const placeholder = !me ? 'Vào chơi để đoán' : isDrawer ? 'Bạn đang vẽ' : guessed ? 'Bạn đã đoán đúng!' : s.phase === 'draw' ? 'Gõ câu đoán… (Enter)' : 'Chờ lượt vẽ…';
  return (
    <div className="panel sc-feed">
      <div className="sc-feed-box" ref={box} aria-live="polite">
        {s.feed.length === 0 && <div className="muted small">Các câu đoán sẽ hiện ở đây</div>}
        {s.feed.map((f) => (
          <div key={f.n} className={`sc-msg ${f.kind}`}>
            {f.kind === 'guess' ? <><b>{f.name}:</b> {f.text}</> : f.text}
          </div>
        ))}
      </div>
      <form className="sc-guess" onSubmit={submit}>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={60} disabled={!canGuess}
          placeholder={placeholder} aria-label="Đoán" autoComplete="off" autoCapitalize="off" spellCheck={false} />
        <button className="btn primary" disabled={!canGuess || !text.trim()}>Đoán</button>
      </form>
    </div>
  );
}

function Wins({ wins, me }: { wins: ScribbleView['wins']; me: string }) {
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
