import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bird, Flag, Medal, Skull, Trophy } from 'lucide-react';
import { DIFFICULTY, SKY, SUB, SkyhopGame as Engine, TICK_MS, medalFor } from '@game/shared/skyhop';
import type { SkyCommand, SkyPlayerView, SkyhopView } from '@game/shared/skyhop';
import type { ReactNode, RefObject } from 'react';
import type { ClientRoom } from '../store.js';
import { useRoomApp } from '../store.js';
import { useCountdown, useHotkeys } from '../hooks.js';
import GameInfo from '../components/GameInfo.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import { drawSky, SKY_SCALE } from './skyhopRender.js';
import type { SkyGhost, SkyMode } from './skyhopRender.js';
import { prefersReducedMotion, useRaceLoop } from './useRaceLoop.js';
import './SkyhopGame.css';

// Bay qua khe — giao diện riêng: sân chơi dọc (màn tiêu đề, "Chuẩn bị!", thẻ kết quả có huy chương) và
// "Bảng đua" với thanh tiến độ của từng người. Người chơi tự chạy engine; người xem vẽ lại từ server.

const KEYS = [' ', 'ArrowUp', 'w', 'W'];
const MEDAL_CLASS: Record<string, string> = { 'Bạch kim': 'platinum', Vàng: 'gold', Bạc: 'silver', Đồng: 'bronze' };

export default function SkyhopGame({ room, state: s }: { room: ClientRoom; state: SkyhopView }) {
  const { call, user } = useRoomApp();
  const me = s.players.find((p) => p.id === s.myId) ?? null;
  const [watchId, setWatchId] = useState<string | null>(null);
  const [giveup, setGiveup] = useState(false);
  const shown = me ?? s.players.find((p) => p.id === watchId) ?? s.players[0] ?? null;
  const { level, target } = s.options;
  const playing = s.status === 'playing';
  const live = playing && me && !me.done;
  const best = s.wins.find((w) => w.id === (shown?.id ?? user.id))?.best ?? 0;

  return (
    <div className="sh">
      <header className="sh-head">
        <span className="sh-mode"><Bird size={18} aria-hidden /> {target ? `Đua ${target} khe` : 'Sinh tồn'}</span>
        <span className="sh-chip">{DIFFICULTY[level - 1].name}</span>
        {live && (
          <button className="btn sm ghost sh-giveup" onClick={() => setGiveup(true)} aria-label="Bỏ cuộc" title="Bỏ cuộc">
            <Flag size={16} aria-hidden />
          </button>
        )}
      </header>

      <div className="sh-stage">
        {live
          ? <LocalPlay key={`${s.gameNo}-${me.id}`} s={s} me={me} room={room} best={best} />
          : <Watch s={s} room={room} shown={s.status === 'waiting' ? null : shown} best={best} />}
      </div>

      <div className="sh-side">
        {s.status === 'waiting'
          ? <Lobby s={s} ownerId={room.ownerId} />
          : <Standings s={s} shownId={shown?.id ?? null} onPick={me ? null : setWatchId} />}
        {playing && !s.myId && <p className="muted small sh-note">Bạn đang xem — chọn một người trong bảng để xem họ bay.</p>}
      </div>

      {s.status === 'over' && s.result && (
        <GameOverDialog over icon={<Trophy size={26} />} min={1} title={resultTitle(s, user.id)}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} reviewLabel="Xem lại"
          seatBtn={s.myId ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}>
          <GoRanking me={user.id} rows={s.result.ranking.map((id) => {
            const p = s.players.find((x) => x.id === id);
            const medal = medalFor(p?.score ?? 0);
            return { id, name: p?.name ?? '?', value: `${p?.score ?? 0} khe`, note: [endLabel(p), medal && `huy chương ${medal.name}`].filter(Boolean).join(' · ') };
          })} />
        </GameOverDialog>
      )}

      {giveup && (
        <ConfirmDialog title="Bỏ cuộc?" danger okLabel="Bỏ cuộc" icon={<Flag size={22} />}
          onOk={() => call('game:action', { type: 'giveup' })} onClose={() => setGiveup(false)}>
          Số khe đã qua được giữ, nhưng bạn xếp sau người bằng điểm còn bay tới cùng.
        </ConfirmDialog>
      )}

      <GameInfo>
        <Records s={s} me={user.id} />
        <div className="panel small muted sh-rules">
          <b>Luật chơi</b>
          <ul>
            <li>Chim lơ lửng chờ lần chạm đầu (tối đa 5 giây). Chạm vào màn hình, bấm <b>Space</b> hoặc <b>↑</b> để nảy; không chạm thì rơi.</li>
            <li>Luồn qua khe giữa hai cột đá, mỗi khe một điểm. Chạm cột hoặc chạm đất là dừng.</li>
            <li>{target ? `Ai qua đủ ${target} khe sớm nhất thắng (tính cả lúc chờ).` : 'Sinh tồn: qua nhiều khe nhất thắng, bằng nhau thì ai bay lâu hơn.'}</li>
            <li>Huy chương: Đồng 10 · Bạc 20 · Vàng 30 · Bạch kim 40 khe. Mọi người gặp cùng một dãy cột; chấm mờ là người khác.</li>
          </ul>
        </div>
      </GameInfo>
    </div>
  );
}

const END_LABEL = { dead: 'va', finished: 'về đích', gaveUp: 'bỏ cuộc', timedOut: 'hết giờ' } as const;
const endLabel = (p: SkyPlayerView | undefined) => (p?.end ? END_LABEL[p.end] : '');

function resultTitle(s: SkyhopView, me: string) {
  const winner = s.players.find((p) => p.id === s.result?.winner);
  if (s.players.length === 1) return `${s.players[0].score} khe`;
  if (!winner) return 'Không ai thắng';
  return winner.id === me ? 'Bạn thắng!' : `${winner.name} thắng!`;
}

/** Sảnh chờ: ai đang ngồi, sẵn sàng, nút vào chơi / bắt đầu. */
function Lobby({ s, ownerId }: { s: SkyhopView; ownerId: string }) {
  const { call } = useRoomApp();
  const canSit = !s.myId && s.seats.length < s.options.maxSeats;
  return (
    <section className="sh-lobby" aria-label="Sảnh chờ">
      <h3>Người chơi <span className="muted">{s.seats.length}/{s.options.maxSeats}</span></h3>
      <ul className="sh-seats">
        {s.seats.map((p) => (
          <li key={p.id} className={p.id === s.myId ? 'me' : ''}>
            <Bird size={14} aria-hidden /><span className="sh-name">{p.name}</span>
            <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />
          </li>
        ))}
        {!s.seats.length && <li className="muted">Chưa có ai — bấm “Vào chơi”.</li>}
      </ul>
      <div className="sh-lobby-actions">
        <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} min={1} startLabel="Bắt đầu" />
        {s.myId
          ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
          : canSit && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}
      </div>
    </section>
  );
}

/** Bảng đua: xếp theo khe đã qua, thanh tiến độ tới đích (sinh tồn: so với người dẫn đầu). */
function Standings({ s, shownId, onPick }: { s: SkyhopView; shownId: string | null; onPick: ((id: string) => void) | null }) {
  const order = s.result
    ? s.result.ranking.flatMap((id) => s.players.filter((p) => p.id === id))
    : [...s.players].sort((a, b) => b.score - a.score || Number(a.done) - Number(b.done));
  const top = Math.max(10, ...s.players.map((p) => p.score));
  return (
    <section className="sh-board" aria-label="Bảng đua">
      <h3>Bảng đua</h3>
      <ol>
        {order.map((p, i) => {
          const Icon = p.end === 'finished' ? Trophy : p.done ? (p.end === 'gaveUp' ? Flag : Skull) : Bird;
          const pct = Math.min(100, (p.score / (s.options.target || top)) * 100);
          const body = (
            <>
              <span className="sh-rank">{i + 1}</span>
              <span className="sh-who">
                <span className="sh-name">{p.name}{p.id === s.myId && <span className="muted"> (bạn)</span>}</span>
                <span className="sh-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
              </span>
              <Icon size={15} aria-label={endLabel(p) || 'đang bay'} className="sh-state" />
              <b className="sh-score">{p.score}</b>
            </>
          );
          const cls = `sh-row${p.id === s.myId ? ' me' : ''}${p.id === shownId ? ' shown' : ''}${p.done ? ' out' : ''}`;
          return (
            <li key={p.id}>
              {onPick ? <button type="button" className={cls} aria-pressed={p.id === shownId} onClick={() => onPick(p.id)}>{body}</button>
                : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Records({ s, me }: { s: SkyhopView; me: string }) {
  if (!s.wins.length) return null;
  return (
    <div className="panel sh-records">
      <h4>Kỷ lục trong phòng</h4>
      <ol>
        {[...s.wins].sort((a, b) => b.best - a.best).map((w) => {
          const medal = medalFor(w.best);
          return (
            <li key={w.id} className={w.id === me ? 'me' : ''}>
              <span className="sh-name">{w.name}</span>
              {medal && <Medal size={14} className={`sh-medal-ic ${MEDAL_CLASS[medal.name]}`} aria-label={`Huy chương ${medal.name}`} />}
              <b>{w.best}</b><span className="muted small">{w.wins} thắng / {w.games} ván</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Thẻ kết quả trong màn hình, như bảng điểm cổ điển: huy chương, điểm, kỷ lục. */
function ScoreCard({ score, best, title }: { score: number; best: number; title: string }) {
  const medal = medalFor(score);
  return (
    <div className="sh-card" role="status">
      <strong className="sh-card-title">{title}</strong>
      <div className="sh-card-body">
        <div className={`sh-medal ${medal ? MEDAL_CLASS[medal.name] : 'none'}`}>
          <Medal size={30} aria-hidden />
          <span>{medal ? `Huy chương ${medal.name}` : 'Chưa có huy chương'}</span>
        </div>
        <dl>
          <dt>Điểm</dt><dd>{score}</dd>
          <dt>Kỷ lục</dt><dd>{Math.max(best, score)}{score > best && best > 0 && <span className="sh-new">Mới</span>}</dd>
        </dl>
      </div>
    </div>
  );
}

function Screen({ canvasRef, live, children, onPress }: {
  canvasRef: RefObject<HTMLCanvasElement>; live: boolean; children?: ReactNode; onPress?: () => void;
}) {
  return (
    <div className={`sh-screen${live ? ' live' : ''}`} tabIndex={live ? 0 : undefined} role={live ? 'button' : undefined}
      aria-label={live ? 'Màn hình bay — chạm hoặc bấm Space để nảy' : undefined}
      onPointerDown={onPress ? (e) => { e.preventDefault(); onPress(); } : undefined}>
      <canvas ref={canvasRef} width={SKY.W * SKY_SCALE} height={SKY.H * SKY_SCALE} role="img" aria-label="Bay qua khe" />
      {children}
    </div>
  );
}

/** Người khác dưới dạng chấm mờ, tính theo quãng đã bay (sau lần chạm đầu). */
const ghostsOf = (s: SkyhopView, exceptId: string | null): SkyGhost[] => s.players
  .filter((p) => p.id !== exceptId && p.startTick !== null)
  .map((p) => ({ id: p.id, name: p.name, tick: p.tick - (p.startTick ?? 0), y: p.y, done: p.done }));

/** Người xem (hoặc người đã dừng, hoặc lúc chờ ván): vẽ lại từ trạng thái server. */
function Watch({ s, room, shown, best }: { s: SkyhopView; room: ClientRoom; shown: SkyPlayerView | null; best: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const startIn = useCountdown(Math.max(0, s.startIn), room.receivedAt, s.status === 'playing' && s.startIn > 0);
  const world = useMemo(() => new Engine({ seed: s.seed, level: s.options.level, target: s.options.target }), [s.seed, s.options.level, s.options.target]);
  const still = useMemo(prefersReducedMotion, []);
  const mode: SkyMode = !shown ? 'title' : shown.startTick === null ? 'ready' : shown.end === 'dead' ? 'dead' : 'fly';
  useEffect(() => {
    let frame = 0;
    const paint = (now: number) => {
      if (cv.current) {
        drawSky(cv.current, {
          mode, tick: shown && shown.startTick !== null ? shown.tick - shown.startTick : 0, alpha: 0, now, sinceHit: -1,
          y: shown?.y ?? 230 * SUB, vy: shown?.vy ?? 0, score: shown?.score ?? 0, target: s.options.target,
          speed: world.speed, gap: world.gap, gapCenter: (k) => world.gapCenter(k), dead: shown?.end === 'dead',
          ghosts: ghostsOf(s, shown?.id ?? null), still,
        });
      }
      // Chỉ màn tiêu đề / Chuẩn bị cần vẽ liên tục (chim nhấp nhô); còn lại vẽ lại khi server gửi trạng thái mới
      if (!still && (mode === 'title' || mode === 'ready')) frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  });
  return (
    <Screen canvasRef={cv} live={false}>
      {s.status === 'playing' && startIn > 0 && <div className="sh-overlay"><span className="sh-count">{Math.ceil(startIn / 1000)}</span></div>}
      {shown?.done && <ScoreCard score={shown.score} best={best} title={shown.end === 'finished' ? 'Về đích!' : shown.id === s.myId ? 'Kết thúc' : shown.name} />}
    </Screen>
  );
}

function LocalPlay({ s, me, room, best }: { s: SkyhopView; me: SkyPlayerView; room: ClientRoom; best: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const sRef = useRef(s);
  useEffect(() => { sRef.current = s; }, [s]);
  const hitAt = useRef<number | null>(null);
  const [result, setResult] = useState<{ score: number; finished: boolean } | null>(null);
  const still = useMemo(prefersReducedMotion, []);
  const create = useCallback(() => new Engine({ seed: s.seed, level: s.options.level, target: s.options.target }), [s.seed, s.options.level, s.options.target]);
  const draw = useCallback((game: Engine, alpha: number, now: number) => {
    if (game.over && hitAt.current === null) {
      hitAt.current = now;
      setResult({ score: game.score, finished: game.finished });
    }
    if (!cv.current) return;
    drawSky(cv.current, {
      mode: game.startTick === null ? 'ready' : game.dead ? 'dead' : 'fly',
      tick: game.startTick === null ? 0 : game.tick - game.startTick, alpha, now,
      sinceHit: hitAt.current === null ? -1 : now - hitAt.current,
      y: game.y, vy: game.vy, score: game.score, target: game.target, speed: game.speed, gap: game.gap,
      gapCenter: (k) => game.gapCenter(k), dead: game.dead, ghosts: ghostsOf(sRef.current, me.id), still,
    });
  }, [me.id, still]);
  const { command, countdown } = useRaceLoop<Engine, SkyCommand>({
    me, tickMs: TICK_MS, startAt: room.receivedAt + s.startIn, create, draw,
  });
  const flap = useCallback(() => { command('flap'); }, [command]);
  useHotkeys(Object.fromEntries(KEYS.map((k) => [k, (e: KeyboardEvent) => { if (!e.repeat) flap(); }])));

  return (
    <Screen canvasRef={cv} live onPress={flap}>
      {countdown > 0 && <div className="sh-overlay"><span className="sh-count">{countdown}</span></div>}
      {result && <ScoreCard score={result.score} best={best} title={result.finished ? 'Về đích!' : 'Kết thúc'} />}
    </Screen>
  );
}
