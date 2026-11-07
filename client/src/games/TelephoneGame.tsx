import { useEffect, useRef, useState } from 'react';
import { Timer, Check, Pencil, PenLine, Eye, ChevronRight, Shuffle, CircleStop, BookOpen, PartyPopper } from 'lucide-react';
import { CANVAS_W, CANVAS_H } from '@game/shared/scribble';
import { useRoomApp } from '../store.js';
import { queryGame, request } from '../socket.js';
import type { AppContextValue, ClientRoom } from '../store.js';
import type { TelephoneTaskView, TelephoneView } from '@game/shared/views';
import type { DrawOp } from '@game/shared/scribble';
import type { FormEvent } from 'react';
import type { CanvasHandle } from './ScribbleCanvas.js';

type Act = AppContextValue['act'];
import GameInfo from '../components/GameInfo.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import GameOverDialog from '../components/GameOverDialog.js';
import { useCountdown, useHotkeys } from '../hooks.js';
import ScribbleCanvas, { renderOps } from './ScribbleCanvas.js';
import DrawTools, { useDrawTools } from './DrawTools.js';
import './TelephoneGame.css';

export default function TelephoneGame({ room, state: s }: { room: ClientRoom; state: TelephoneView }) {
  const { act, call, user } = useRoomApp();
  const isOwner = room.ownerId === user.id;
  const playing = s.status === 'playing';
  const relay = s.options.mode === 'relay';
  const active = s.players.find((p) => p.id === s.activeId);
  const [stop, setStop] = useState(false);
  const timeLeft = useCountdown(s.phaseLeft, room.receivedAt, playing && !!s.phaseLeft);
  const inGame = s.players.some((p) => p.id === user.id);
  // Bước vẽ: đề bài + nút Xong nằm luôn trên thanh đầu, khung vẽ chiếm phần còn lại của màn hình
  const drawTask = playing && s.task?.kind === 'draw' ? s.task : null;
  const over = s.status === 'over';
  const seatBtn = s.myId ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
    : s.seats.length < s.options.maxSeats && (
      <button className="btn primary" onClick={() => call('room:sit', {})}>{playing || s.status === 'reveal' ? 'Ngồi chờ ván sau' : 'Vào chơi'}</button>
    );

  return (
    <div className={`tp ${drawTask && !drawTask.prev?.drawId ? 'tp-fill' : ''}`}>
      {playing && (
        <div className="panel tp-top">
          <span className="tp-step">Bước <b>{s.step + 1}</b>/{s.steps}</span>
          <span className="tp-title">
            {drawTask ? <>{drawTask.prev?.kind === 'draw' ? 'Vẽ lại hình của người trước' : <>Vẽ: <b className="tp-what">{drawTask.prev?.text || '(người trước bỏ trống — vẽ gì tùy bạn!)'}</b></>}</> : relay && active ? `${active.name} đang ${s.kind === 'draw' ? 'vẽ' : 'đoán'}` : stepTitle(s)}
          </span>
          <span className={`sc-time ${timeLeft < 10000 ? 'low' : ''}`}><Timer size={14} aria-hidden /> {Math.ceil(timeLeft / 1000)}s</span>
          {drawTask && (
            <button className={`btn sm ${drawTask.done ? '' : 'cta'} tp-done-btn`} onClick={() => act({ type: 'done', done: !drawTask.done })}>
              {drawTask.done ? <><Pencil size={15} aria-hidden /> Vẽ tiếp</> : <><Check size={16} aria-hidden /> Xong</>}
            </button>
          )}
        </div>
      )}
      {playing && <Progress s={s} />}

      {playing && s.task && <Task key={s.turnNo} s={s} task={s.task} act={act} timeLeft={timeLeft} />}
      {playing && !s.task && (
        <div className="panel tp-wait">
          <Eye size={20} aria-hidden /> {inGame && !s.players.find((p) => p.id === user.id)?.gone ? `Chờ ${active?.name || 'mọi người'} hoàn thành lượt.` : inGame ? 'Bạn đã rời ván này.' : s.myId ? 'Bạn đang ngồi chờ ván sau.' : 'Bạn đang xem.'}{' '}
          Bài của mọi người được giữ kín — cuối ván sẽ cùng xem lại.
        </div>
      )}

      <GameOverDialog over={over} icon={<PartyPopper size={26} />}
        detail={`${s.albums?.length || 0} câu chuyện đã đi qua ${s.steps} người. Xem lại xem chúng “thất bản” tới đâu, hoặc chơi luôn ván mới.`}
        seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} min={s.minPlayers}
        seatBtn={seatBtn} reviewLabel="Xem lại các câu chuyện" ReviewIcon={BookOpen} />
      {(s.status === 'reveal' || over) && <Albums s={s} isOwner={isOwner} act={act} />}

      {s.status === 'waiting' && (
        <div className="panel tp-intro">
          <div className="tp-big">🖍️ Tam sao thất bản</div>
          <p className="muted">{relay ? 'Chuyền hình: người đầu nhận từ khóa và vẽ → từng người sau xem hình ngay trước và vẽ lại → người cuối đoán. Thứ tự được xáo trộn mỗi vòng!' : 'Viết một câu → người sau vẽ lại → người sau nữa nhìn tranh đoán bằng lời → lại vẽ… Cuối ván xem câu chuyện “thất bản” tới đâu!'}</p>
          <ul className="tp-seats">
            {s.seats.map((x) => <li key={x.id}>{x.name}{x.id === user.id && <span className="muted"> (bạn)</span>}<ReadyMark id={x.id} ready={s.ready} ownerId={room.ownerId} /></li>)}
            {s.seats.length === 0 && <li className="muted">Chưa có ai ngồi</li>}
          </ul>
        </div>
      )}

      {!over && (
        <div className="board-actions">
          {s.status === 'waiting' && (
            <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} min={s.minPlayers} />
          )}
          {seatBtn}
          {playing && isOwner && <button className="btn ghost" onClick={() => setStop(true)}><CircleStop size={14} aria-hidden /> Dừng ván</button>}
        </div>
      )}


      <GameInfo>
        <div className="panel small muted wc-rules">
          <b>Luật chơi</b>
          <ul>
            {relay ? <li>Mỗi lượt chỉ một người làm: người đầu vẽ từ khóa, người sau chỉ xem hình ngay trước để vẽ lại ({s.options.drawSeconds} giây/lượt). Người cuối đoán ({s.options.writeSeconds} giây). Xáo trộn thứ tự mỗi vòng.</li> : <>
            <li>Mọi người làm <b>cùng lúc</b>. Bước đầu: mỗi người viết một câu ({s.options.writeSeconds} giây).</li>
            <li>Bước sau: bạn nhận câu của người khác và <b>vẽ</b> lại ({s.options.drawSeconds} giây) — không được viết chữ lên tranh.</li>
            <li>Bước tiếp: nhận tranh của người khác và <b>đoán bằng lời</b> tranh vẽ gì. Cứ thế xen kẽ đến khi câu chuyện đi qua đủ mọi người.</li>
            </>}
            <li>Hết giờ mà chưa bấm Xong thì phần đang làm dở vẫn được tính.</li>
            <li>Cuối ván chủ phòng bấm <b>Tiếp</b> để lật từng phần của từng câu chuyện cho cả bàn cùng xem.</li>
            <li>Cần ít nhất {s.minPlayers} người.</li>
          </ul>
        </div>
      </GameInfo>

      {stop && (
        <ConfirmDialog title="Dừng ván này?" danger okLabel="Dừng ván" onOk={() => act({ type: 'stop' })} onClose={() => setStop(false)}>
          Ván dừng ngay và chuyển sang xem lại các câu chuyện đã làm được.
        </ConfirmDialog>
      )}
    </div>
  );
}

const stepTitle = (s: TelephoneView) => (s.step === 0 ? 'Viết một câu' : s.kind === 'draw' ? 'Vẽ lại câu được giao' : 'Đoán xem tranh vẽ gì');

function Progress({ s }: { s: TelephoneView }) {
  return (
    <div className="tp-progress" aria-label="Tiến độ">
      {s.players.map((p) => (
        <span key={p.id} className={`tp-chip ${p.done ? 'done' : ''} ${p.gone ? 'gone' : ''}`}>
          {p.done || (s.activeId && s.players.findIndex((x) => x.id === p.id) < s.step) ? <Check size={13} aria-label="xong" /> : <PenLine size={13} aria-label={s.activeId && s.activeId !== p.id ? 'chờ lượt' : 'đang làm'} />} {p.name}{s.activeId === p.id && ' (đang chơi)'}
        </span>
      ))}
    </div>
  );
}

/** Việc của mình ở bước hiện tại: viết câu / vẽ / đoán tranh. Bản nháp tự lưu lên server. */
function Task({ s, task, act, timeLeft }: { s: TelephoneView; task: TelephoneTaskView; act: Act; timeLeft: number }) {
  if (task.kind === 'draw') return <DrawTask s={s} task={task} />;
  return <TextTask task={task} act={act} timeLeft={timeLeft} />;
}

function TextTask({ task, act }: { task: TelephoneTaskView; act: Act; timeLeft?: number }) {
  const [text, setText] = useState(task.text);
  const [k, setK] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!task.done) ref.current?.focus({ preventScroll: true }); }, [task.done]);
  // Lưu nháp sau khi ngừng gõ: hết giờ chưa bấm Xong vẫn được tính
  useEffect(() => {
    if (task.done || text === task.text) return undefined;
    const t = setTimeout(() => request('game:action', { type: 'text', text, done: false }).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [text]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    act({ type: 'text', text, done: !task.done });
  };
  const first = !task.prev;
  const suggestions = task.suggestions ?? [];
  return (
    <div className="tp-task">
      {task.prev?.kind === 'draw' && task.prev.drawId && <DrawingView id={task.prev.drawId} />}
      <form className="panel tp-text" onSubmit={submit}>
        <label htmlFor="tp-input">{first ? 'Viết một câu (con vật, tình huống, câu thành ngữ…) để người sau vẽ:' : 'Tranh trên vẽ gì? Viết lại bằng lời:'}</label>
        <div className="tp-row">
          <input id="tp-input" ref={ref} value={text} maxLength={80} disabled={task.done} autoComplete="off" spellCheck={false}
            onChange={(e) => setText(e.target.value)} placeholder={first ? 'vd: con mèo đi xe đạp trên mặt trăng' : 'vd: chú chó đội mũ bảo hiểm'} />
          <button className={`btn ${task.done ? '' : 'cta'}`} disabled={!task.done && !text.trim()}>
            {task.done ? <><Pencil size={15} aria-hidden /> Sửa lại</> : <><Check size={16} aria-hidden /> Xong</>}
          </button>
        </div>
        {first && suggestions.length > 0 && !task.done && (
          <button type="button" className="link tp-suggest" onClick={() => { setText(suggestions[k % suggestions.length]); setK(k + 1); }}>
            <Shuffle size={13} aria-hidden /> Bí ý tưởng? Lấy gợi ý
          </button>
        )}
        {task.done && <div className="muted small">Đã nộp — đang chờ mọi người…</div>}
      </form>
    </div>
  );
}

/** Bước vẽ: màn rộng thì công cụ là cột dọc bên trái khung vẽ; điện thoại thì nằm ngay dưới khung. */
function DrawTask({ s, task }: { s: TelephoneView; task: TelephoneTaskView }) {
  const canvas = useRef<CanvasHandle>(null);
  const canDraw = !task.done;
  const t = useDrawTools(canvas, canDraw);
  return (
    <div className={`tp-draw ${task.prev?.drawId ? 'tp-relay-draw' : ''}`}>
      {task.prev?.drawId && <div className="tp-reference"><p className="muted small">Hình của người trước</p><DrawingView id={task.prev.drawId} /></div>}
      {canDraw && <DrawTools t={t} canvas={canvas} className="tp-tools" />}
      <div className="tp-canvas-box">
        <div className={`sc-stage ${canDraw ? 'my-turn' : ''}`}>
          <ScribbleCanvas ref={canvas} turn={s.turnNo} canDraw={canDraw} tool={t.tool} color={t.color} size={t.brush} />
          {task.done && <div className="sc-overlay tp-done-ov"><Check size={22} aria-hidden /> Đã nộp — đang chờ mọi người…</div>}
        </div>
      </div>
    </div>
  );
}

// Bức vẽ đã nộp không đổi nữa → giữ lại để khỏi tải lại
const drawingCache = new Map<string, DrawOp[]>();

/** Hiển thị một bức vẽ đã nộp (tải theo yêu cầu). */
function DrawingView({ id, small = false }: { id: string; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState(drawingCache.has(id) ? 'ok' : 'loading');
  useEffect(() => {
    let alive = true;
    const draw = (ops: DrawOp[]) => {
      const ctx = ref.current?.getContext('2d', { willReadFrequently: true });
      if (ctx) renderOps(ctx, ops);
    };
    const cached = drawingCache.get(id);
    if (cached) { draw(cached); setState('ok'); return undefined; }
    setState('loading');
    queryGame({ type: 'drawing', id })
      .then((data) => {
        drawingCache.set(id, data.ops);
        if (alive) { draw(data.ops); setState('ok'); }
      })
      .catch(() => alive && setState('error'));
    return () => { alive = false; };
  }, [id]);
  return (
    <div className={`tp-drawing ${small ? 'small' : ''}`}>
      <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} role="img" aria-label="Bức vẽ" />
      {state !== 'ok' && <div className="tp-drawing-msg muted small">{state === 'loading' ? 'Đang tải tranh…' : 'Không tải được tranh'}</div>}
    </div>
  );
}

/** Xem lại các câu chuyện: lúc lật (chủ phòng bấm Tiếp) và sau khi ván xong (tự chọn câu chuyện). */
function Albums({ s, isOwner, act }: { s: TelephoneView; isOwner: boolean; act: Act }) {
  const revealing = s.status === 'reveal';
  const [pick, setPick] = useState(0);
  const albums = s.albums ?? [];
  const cur = revealing ? s.reveal?.album ?? 0 : Math.min(pick, albums.length - 1);
  const album = albums[cur];
  const endRef = useRef<HTMLDivElement>(null);
  const count = album?.entries.length || 0;
  useEffect(() => { if (revealing) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [revealing, cur, count]);
  useHotkeys({ ArrowRight: () => act({ type: 'next' }), ' ': () => act({ type: 'next' }) }, revealing && isOwner);
  if (!album) return null;
  const total = s.step + (s.options.mode === 'relay' ? 1 : 0);
  return (
    <div className="tp-albums">
      <div className="panel tp-album-head">
        <BookOpen size={18} aria-hidden />
        <b>Câu chuyện của {album.owner}</b>
        <span className="muted small">({cur + 1}/{albums.length})</span>
        {!revealing && (
          <div className="tabs sm tp-album-tabs" role="tablist">
            {albums.map((a, i) => (
              <button key={i} role="tab" aria-selected={i === cur} className={`tab ${i === cur ? 'active' : ''}`} onClick={() => setPick(i)}>{a.owner}</button>
            ))}
          </div>
        )}
      </div>
      <ol className="tp-entries">
        {album.entries.map((e, k) => (
          <li key={k} className={`tp-entry ${e.kind}`}>
            <div className="tp-by muted small">{k === 0 ? `${e.name} viết` : e.kind === 'draw' ? `${e.name} vẽ` : `${e.name} đoán`}</div>
            {e.kind === 'text'
              ? <div className={`tp-bubble ${k === 0 ? 'first' : ''}`}>{e.text || <span className="muted">(bỏ trống)</span>}</div>
              : <DrawingView id={e.drawId ?? ''} small />}
          </li>
        ))}
      </ol>
      <div ref={endRef} />
      {revealing && (
        <div className="board-actions">
          {isOwner ? (
            <button className="btn cta" onClick={() => act({ type: 'next' })}>
              <ChevronRight size={16} aria-hidden />
              {count < total || cur < albums.length - 1 ? 'Tiếp' : 'Kết thúc'} <kbd>→</kbd>
            </button>
          ) : <span className="muted small ba-note">Chủ phòng đang lật từng phần…</span>}
        </div>
      )}
    </div>
  );
}
