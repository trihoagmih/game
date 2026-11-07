import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Bomb, BookOpen, ChevronsRight, Clover, Flag, FlaskConical, Gem, Pickaxe, ShoppingBag, Skull, Trophy } from 'lucide-react';
import { GOODS, GoldmineGame as Engine, MINE, TICK_MS, buyCommand, goalFor } from '@game/shared/goldmine';
import type { Good, GoldmineView, MineCommand, MinePlayerView, MineSnapshot } from '@game/shared/goldmine';
import type { LucideIcon } from 'lucide-react';
import type { MutableRefObject, ReactNode, RefObject } from 'react';
import type { ClientRoom } from '../store.js';
import { useRoomApp } from '../store.js';
import { useCountdown, useHotkeys } from '../hooks.js';
import GameInfo from '../components/GameInfo.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import { drawMine, MINE_SCALE } from './goldmineRender.js';
import { prefersReducedMotion, useRaceLoop } from './useRaceLoop.js';
import { usePersonalBest } from './usePersonalBest.js';
import './GoldmineGame.css';

// Đào vàng — giao diện riêng: mỏ vẽ trên canvas với thanh tiền/thời gian trên bầu trời như bản cổ điển,
// cửa hàng thay chỗ mỏ giữa các màn, "Bảng tiền" xếp người chơi theo tiền. Chạm / Space / ↓ phóng móc,
// ↑ hoặc B ném thuốc nổ; ở cửa hàng phím 1–5 mua, Enter sang màn.

const money = (n: number) => `${n.toLocaleString('vi-VN')}$`;
const GOOD_ICON: Record<Good, LucideIcon> = { dynamite: Bomb, strength: FlaskConical, clover: Clover, rockBook: BookOpen, polish: Gem };
/** Trạng thái cục bộ cho thanh nút / cửa hàng; chỉ cập nhật khi đổi để không render lại mỗi khung hình. */
type Local = Pick<MineSnapshot, 'phase' | 'money' | 'dynamite' | 'level' | 'offers'> & { shopSeconds: number; grabbing: boolean };
const localOf = (m: MineSnapshot): Local => ({
  phase: m.phase, money: m.money, dynamite: m.dynamite, level: m.level, offers: m.offers,
  shopSeconds: Math.ceil((m.shopLeft * TICK_MS) / 1000), grabbing: m.hook.state === 'back' && m.hook.grab !== null,
});
const sameLocal = (a: Local, b: Local) => a.phase === b.phase && a.money === b.money && a.dynamite === b.dynamite && a.level === b.level
  && a.shopSeconds === b.shopSeconds && a.grabbing === b.grabbing && a.offers.length === b.offers.length
  && a.offers.every((o, i) => o.bought === b.offers[i].bought);
type Command = (c: MineCommand) => boolean;

export default function GoldmineGame({ room, state: s }: { room: ClientRoom; state: GoldmineView }) {
  const { call, user } = useRoomApp();
  const me = s.players.find((p) => p.id === s.myId) ?? null;
  const [watchId, setWatchId] = useState<string | null>(null);
  const [giveup, setGiveup] = useState(false);
  const shown = me ?? s.players.find((p) => p.id === watchId) ?? s.players[0] ?? null;
  const best = usePersonalBest('gm', Math.max(0, ...s.players.map((p) => p.score)));
  const playing = s.status === 'playing';
  const live = playing && me && !me.done;
  const [local, setLocal] = useState<Local | null>(null);
  const commandRef = useRef<Command | null>(null);
  const press = (c: MineCommand) => commandRef.current?.(c);
  const shopping = live ? local?.phase === 'shop' : s.status === 'playing' && shown?.mine.phase === 'shop' && !shown.done;

  return (
    <div className={`gm${playing ? ' active' : ''}${shopping ? ' shopping' : ''}`}>
      <header className="gm-head">
        <span className="gm-best" title="Kỷ lục trên thiết bị này">🏆 {best.toLocaleString('vi-VN')}</span>
        <span className="gm-title"><Pickaxe size={18} aria-hidden /> Đào vàng</span>
        <span className="gm-chip">{s.options.levels} màn · 60 giây/màn</span>
        {live && (
          <button className="btn sm ghost gm-giveup" onClick={() => setGiveup(true)} aria-label="Bỏ cuộc" title="Bỏ cuộc">
            <Flag size={16} aria-hidden />
          </button>
        )}
      </header>

      <div className="gm-stage">
        {live
          ? <LocalPlay key={`${s.gameNo}-${me.id}`} s={s} me={me} room={room} onLocal={setLocal} commandRef={commandRef} />
          : <Watch s={s} room={room} shown={s.status === 'waiting' ? null : shown} />}
      </div>

      {live && local?.phase === 'play' && (
        <div className="gm-pad" role="group" aria-label="Điều khiển">
          <button type="button" className="btn primary" onClick={() => press('shoot')}><ArrowDownToLine size={18} aria-hidden /> Phóng móc</button>
          <button type="button" className="btn gm-dyn" disabled={!local.dynamite || !local.grabbing} onClick={() => press('boom')}>
            <Bomb size={18} aria-hidden /> Thuốc nổ <b>{local.dynamite}</b>
          </button>
        </div>
      )}

      <div className="gm-side">
        {s.status === 'waiting'
          ? <Lobby s={s} ownerId={room.ownerId} />
          : <Ledger s={s} shownId={shown?.id ?? null} onPick={me ? null : setWatchId} />}
        {playing && !s.myId && <p className="muted small gm-note">Bạn đang xem — chọn một người trong bảng để xem mỏ của họ.</p>}
      </div>

      {s.status === 'over' && s.result && (
        <GameOverDialog over icon={<Trophy size={26} />} min={1} title={resultTitle(s, user.id)}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} reviewLabel="Xem lại mỏ"
          seatBtn={s.myId ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}>
          <GoRanking me={user.id} rows={s.result.ranking.map((id) => {
            const p = s.players.find((x) => x.id === id);
            return { id, name: p?.name ?? '?', value: money(p?.score ?? 0), note: p ? statusText(p, s.options.levels) : '' };
          })} />
        </GameOverDialog>
      )}

      {giveup && (
        <ConfirmDialog title="Bỏ cuộc?" danger okLabel="Bỏ cuộc" icon={<Flag size={22} />}
          onOk={() => call('game:action', { type: 'giveup' })} onClose={() => setGiveup(false)}>
          Số tiền hiện có được giữ, nhưng bạn xếp sau người bằng tiền còn đào tới cùng.
        </ConfirmDialog>
      )}

      <GameInfo>
        <Records s={s} me={user.id} />
        <div className="panel small muted gm-rules">
          <b>Luật chơi</b>
          <ul>
            <li>Móc lắc qua lại. Chạm vào mỏ, bấm <b>Space</b> hoặc <b>↓</b> để phóng; móc gắp món đầu tiên chạm phải.</li>
            <li>Vàng to và đá nặng kéo rất chậm, kim cương nhẹ mà đắt, chuột ôm kim cương đáng giá. Đụng thùng <b>TNT</b> là nổ hết đồ quanh nó.</li>
            <li>Đang kéo món không muốn lấy thì bấm <b>↑</b> hoặc <b>B</b> để ném thuốc nổ. Túi <b>?</b> có thể là tiền, thuốc nổ hoặc nước tăng lực.</li>
            <li>Mỗi màn 60 giây; hết giờ phải đạt mục tiêu cộng dồn (650$, 1.195$, 2.010$…). Qua màn thì vào cửa hàng (phím 1–5 mua, Enter sang màn).</li>
            <li>Mọi người cùng bản đồ — nhiều tiền nhất thắng.</li>
          </ul>
        </div>
      </GameInfo>
    </div>
  );
}

function statusText(p: MinePlayerView, levels: number) {
  if (p.end === 'finished') return `qua hết ${levels} màn`;
  if (p.end === 'gaveUp') return 'bỏ cuộc';
  if (p.done) return `dừng ở màn ${p.mine.level}`;
  return p.mine.phase === 'shop' ? `cửa hàng sau màn ${p.mine.level}` : `màn ${p.mine.level}`;
}

function resultTitle(s: GoldmineView, me: string) {
  const winner = s.players.find((p) => p.id === s.result?.winner);
  if (s.players.length === 1) return money(s.players[0].score);
  if (!winner) return 'Không ai thắng';
  return winner.id === me ? 'Bạn thắng!' : `${winner.name} thắng!`;
}

function Lobby({ s, ownerId }: { s: GoldmineView; ownerId: string }) {
  const { call } = useRoomApp();
  const canSit = !s.myId && s.seats.length < s.options.maxSeats;
  return (
    <section className="gm-panel" aria-label="Sảnh chờ">
      <h3>Thợ đào <span className="muted">{s.seats.length}/{s.options.maxSeats}</span></h3>
      <ul className="gm-seats">
        {s.seats.map((p) => (
          <li key={p.id} className={p.id === s.myId ? 'me' : ''}>
            <Pickaxe size={14} aria-hidden /><span className="gm-name">{p.name}</span>
            <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />
          </li>
        ))}
        {!s.seats.length && <li className="muted">Chưa có ai — bấm “Vào chơi”.</li>}
      </ul>
      <div className="gm-lobby-actions">
        <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} min={1} startLabel="Bắt đầu" />
        {s.myId
          ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
          : canSit && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}
      </div>
    </section>
  );
}

/** Bảng tiền: xếp theo tiền, thanh tiến độ tới mục tiêu màn đang chơi. */
function Ledger({ s, shownId, onPick }: { s: GoldmineView; shownId: string | null; onPick: ((id: string) => void) | null }) {
  const order = s.result
    ? s.result.ranking.flatMap((id) => s.players.filter((p) => p.id === id))
    : [...s.players].sort((a, b) => b.score - a.score || b.mine.level - a.mine.level);
  return (
    <section className="gm-panel" aria-label="Bảng tiền">
      <h3>Bảng tiền</h3>
      <ol className="gm-ledger">
        {order.map((p, i) => {
          const Icon = p.end === 'finished' ? Trophy : p.end === 'gaveUp' ? Flag : p.done ? Skull : p.mine.phase === 'shop' ? ShoppingBag : Pickaxe;
          const pct = Math.min(100, (p.score / p.mine.goal) * 100);
          const body = (
            <>
              <span className="gm-rank">{i + 1}</span>
              <span className="gm-who">
                <span className="gm-name">{p.name}{p.id === s.myId && <span className="muted"> (bạn)</span>}</span>
                <span className="gm-sub"><Icon size={13} aria-hidden /> {statusText(p, s.options.levels)}</span>
                <span className={`gm-bar${pct >= 100 ? ' ok' : ''}`} aria-hidden><span style={{ width: `${pct}%` }} /></span>
              </span>
              <b className="gm-money">{money(p.score)}</b>
            </>
          );
          const cls = `gm-row${p.id === s.myId ? ' me' : ''}${p.id === shownId ? ' shown' : ''}${p.done ? ' out' : ''}`;
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

function Records({ s, me }: { s: GoldmineView; me: string }) {
  if (!s.wins.length) return null;
  return (
    <div className="panel gm-records">
      <h4>Kỷ lục trong phòng</h4>
      <ol>
        {[...s.wins].sort((a, b) => b.best - a.best).map((w) => (
          <li key={w.id} className={w.id === me ? 'me' : ''}>
            <span className="gm-name">{w.name}</span><b>{money(w.best)}</b><span className="muted small">{w.wins} thắng / {w.games} ván</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Cửa hàng giữa các màn, thay chỗ mỏ. `onBuy`/`onLeave` null khi chỉ xem người khác mua. */
function Shop({ mine, seconds, onBuy, onLeave }: {
  mine: Pick<MineSnapshot, 'level' | 'money' | 'offers'>; seconds: number; onBuy: ((slot: number) => void) | null; onLeave: (() => void) | null;
}) {
  return (
    <section className="gm-shop" aria-label="Cửa hàng">
      <header className="gm-shop-head">
        <div className="gm-shop-sign" aria-hidden>⛏ TIỆM ĐỒ THỢ MỎ ⛏</div>
        <h3><ShoppingBag size={18} aria-hidden /> Cửa hàng</h3>
        <span className="gm-shop-money">Có <b>{money(mine.money)}</b></span>
        <span className="muted small">Màn {mine.level + 1} cần {money(goalFor(mine.level + 1))} · còn {seconds} giây</span>
      </header>
      <ul className="gm-goods">
        {mine.offers.map((o, slot) => {
          const Icon = GOOD_ICON[o.good];
          return (
            <li key={o.good} className={o.bought ? 'bought' : ''}>
              <Icon size={26} aria-hidden className={`gm-good-ic ${o.good}`} />
              <span className="gm-good-name">{GOODS[o.good].name}</span>
              <span className="gm-good-note small muted">{GOODS[o.good].note}</span>
              <b className="gm-good-price">{money(o.price)}</b>
              {onBuy && (
                <button type="button" className="btn sm" disabled={o.bought || mine.money < o.price} onClick={() => onBuy(slot)}
                  aria-label={`Mua ${GOODS[o.good].name} (phím ${slot + 1})`}>
                  {o.bought ? 'Đã mua' : `Mua · ${slot + 1}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {onLeave && <button type="button" className="btn cta gm-next" onClick={onLeave}>Sang màn {mine.level + 1} <ChevronsRight size={18} aria-hidden /></button>}
    </section>
  );
}

function Screen({ canvasRef, live, children, onPress }: {
  canvasRef: RefObject<HTMLCanvasElement>; live: boolean; children?: ReactNode; onPress?: () => void;
}) {
  return (
    <div className={`gm-screen${live ? ' live' : ''}`} tabIndex={live ? 0 : undefined} role={live ? 'button' : undefined}
      aria-label={live ? 'Mỏ vàng — chạm hoặc bấm Space để phóng móc' : undefined}
      onPointerDown={onPress ? (e) => { e.preventDefault(); onPress(); } : undefined}>
      <canvas ref={canvasRef} width={MINE.W * MINE_SCALE} height={MINE.H * MINE_SCALE} role="img" aria-label="Mỏ vàng" />
      {children}
    </div>
  );
}

function EndCard({ title, detail }: { title: string; detail: string }) {
  return <div className="gm-card" role="status"><strong>{title}</strong><span>{detail}</span></div>;
}

/** Người xem (hoặc người đã dừng, hoặc lúc chờ ván): vẽ lại mỏ từ trạng thái server. */
function Watch({ s, room, shown }: { s: GoldmineView; room: ClientRoom; shown: MinePlayerView | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const startIn = useCountdown(Math.max(0, s.startIn), room.receivedAt, s.status === 'playing' && s.startIn > 0);
  const still = useMemo(prefersReducedMotion, []);
  const preview = useMemo(() => new Engine({ seed: 7, levels: 1 }).snapshot(), []);
  const mine = shown?.mine ?? preview;
  const shopping = !!shown && mine.phase === 'shop' && !shown.done;
  useEffect(() => {
    if (!cv.current || shopping) return;
    drawMine(cv.current, { mine, tick: shown?.tick ?? 0, now: performance.now(), still, title: !shown });
  });
  if (shopping) return <Shop mine={mine} seconds={Math.ceil((mine.shopLeft * TICK_MS) / 1000)} onBuy={null} onLeave={null} />;
  return (
    <Screen canvasRef={cv} live={false}>
      {!shown && <div className="gm-title-card"><strong>Đào vàng</strong><span>Chờ thợ đào sẵn sàng, chủ phòng bấm Bắt đầu</span></div>}
      {s.status === 'playing' && startIn > 0 && <div className="gm-overlay"><span className="gm-count">{Math.ceil(startIn / 1000)}</span></div>}
      {shown?.done && <EndCard title={shown.end === 'finished' ? 'Qua hết các màn!' : shown.end === 'gaveUp' ? 'Bỏ cuộc' : 'Chưa đạt mục tiêu'} detail={`${shown.name} · ${money(shown.score)}`} />}
    </Screen>
  );
}

function LocalPlay({ s, me, room, onLocal, commandRef }: {
  s: GoldmineView; me: MinePlayerView; room: ClientRoom; onLocal: (l: Local) => void; commandRef: MutableRefObject<Command | null>;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  const still = useMemo(prefersReducedMotion, []);
  const [local, setLocal] = useState<Local | null>(null);
  const [end, setEnd] = useState<{ cleared: boolean; money: number } | null>(null);
  const last = useRef<Local | null>(null);
  const create = useCallback(() => new Engine({ seed: s.seed, levels: s.options.levels }), [s.seed, s.options.levels]);
  const draw = useCallback((game: Engine, _alpha: number, now: number) => {
    const mine = game.snapshot();
    if (cv.current && mine.phase === 'play') drawMine(cv.current, { mine, tick: game.tick, now, still, title: false });
    if (game.over) setEnd((e) => e ?? { cleared: game.cleared, money: game.money });
    const next = localOf(mine);
    if (last.current && sameLocal(last.current, next)) return;
    last.current = next;
    setLocal(next);
    onLocal(next);
  }, [onLocal, still]);
  const { command, countdown } = useRaceLoop<Engine, MineCommand>({
    me, tickMs: TICK_MS, startAt: room.receivedAt + s.startIn, create, draw,
  });
  useEffect(() => {
    commandRef.current = command;
    return () => { commandRef.current = null; };
  }, [command, commandRef]);
  const buy = useCallback((slot: number) => { const c = buyCommand(slot); if (c) command(c); }, [command]);
  const once = (fn: () => void) => (e: KeyboardEvent) => { if (!e.repeat) fn(); };
  useHotkeys({
    ' ': once(() => command('shoot')),
    ArrowDown: once(() => command('shoot')),
    ArrowUp: once(() => command('boom')),
    b: once(() => command('boom')),
    B: once(() => command('boom')),
    Enter: once(() => command('leave')),
    ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [String(n), once(() => buy(n - 1))])),
  });

  if (local?.phase === 'shop' && !end) return <Shop mine={local} seconds={local.shopSeconds} onBuy={buy} onLeave={() => command('leave')} />;
  return (
    <Screen canvasRef={cv} live onPress={() => command('shoot')}>
      {countdown > 0 && <div className="gm-overlay"><span className="gm-count">{countdown}</span></div>}
      {end && <EndCard title={end.cleared ? 'Qua hết các màn!' : 'Chưa đạt mục tiêu'} detail={`Bạn có ${money(end.money)} — chờ mọi người…`} />}
    </Screen>
  );
}
