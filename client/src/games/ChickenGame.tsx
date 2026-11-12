import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bird, Flag, Trophy } from 'lucide-react';
import { CHICKEN, ChickenGame as Engine } from '@game/shared/chicken';
import type { ChickenCommand, ChickenPlayerView, ChickenView } from '@game/shared/chicken';
import type { ClientRoom } from '../store.js';
import { useRoomApp } from '../store.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import { useRaceLoop } from './useRaceLoop.js';
import { drawChicken } from './chickenRender.js';
import './ChickenGame.css';

export default function ChickenGame({ room, state: s }: { room: ClientRoom; state: ChickenView }) {
  const { call, user } = useRoomApp();
  const [watchId, setWatchId] = useState<string | null>(null);
  const [giveup, setGiveup] = useState(false);
  const me = s.players.find((p) => p.id === s.myId);
  const shown = s.players.find((p) => p.id === watchId) ?? me ?? s.players[0];
  const live = s.status === 'playing' && me && !me.done;
  return <div className="ck">
    <div className="ck-stage">
      {live ? <LocalPlay key={`${s.gameNo}-${me.id}`} s={s} me={me} room={room} /> : <Watch s={s} shown={shown} />}
    </div>
    <aside className="ck-side">
      <div className="ck-heading"><Bird size={24} /><h3>Bắn gà</h3><span className="badge">Arcade</span></div>
      <p className="muted small">Né trứng. Giữ mạng. Phá kỷ lục.</p>
      {s.status === 'waiting' ? <>
        <div className="ck-roster">{s.seats.map((p) => <div className="ck-row" key={p.id}><span>{p.name}</span><ReadyMark id={p.id} ready={s.ready} ownerId={room.ownerId} /></div>)}</div>
        <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} min={1} />
      </> : <div className="ck-roster" aria-label="Bảng điểm">{[...s.players].sort((a, b) => b.score - a.score).map((p) => <button className={`ck-row ${shown?.id === p.id ? 'selected' : ''}`} key={p.id} onClick={() => setWatchId(p.id)} aria-pressed={shown?.id === p.id}><span>{p.name}{p.id === s.myId ? ' (bạn)' : ''}<small>{p.done ? 'Đã kết thúc' : `Đợt ${p.field.wave} · ${p.field.lives} mạng`}</small></span><b>{p.score}</b></button>)}</div>}
      {s.status !== 'playing' && (s.myId ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button> : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>)}
      {live && <button className="btn ghost" onClick={() => setGiveup(true)}><Flag size={16} /> Bỏ cuộc</button>}
      <div className="ck-help small muted"><b>Cách chơi</b><p>Giữ ← / → hoặc A / D để lái. Phi thuyền tự bắn. Trên điện thoại, giữ nút mũi tên bên dưới.</p><p>Mỗi gà: 10 × số đợt điểm. Gà vàng cần 2 phát. Hết 3 mạng hoặc gà chạm phi thuyền là kết thúc. Ván tối đa 5 phút; bằng điểm thì người trụ lâu hơn xếp trên.</p></div>
    </aside>
    {giveup && <ConfirmDialog title="Bỏ cuộc?" danger okLabel="Bỏ cuộc" onOk={() => call('game:action', { type: 'giveup' })} onClose={() => setGiveup(false)}>Điểm hiện tại được giữ trong bảng xếp hạng.</ConfirmDialog>}
    {s.status === 'over' && s.result && <GameOverDialog over icon={<Trophy size={26} />} min={1} title="Kết quả bắn gà" seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} reviewLabel="Xem lại">
      <GoRanking me={user.id} rows={s.result.ranking.map((id) => { const p = s.players.find((x) => x.id === id); return { id, name: p?.name ?? '?', value: `${p?.score ?? 0} điểm`, note: `Đợt ${p?.field.wave ?? 1}` }; })} />
    </GameOverDialog>}
  </div>;
}

function Watch({ s, shown }: { s: ChickenView; shown: ChickenPlayerView | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const demo = useMemo(() => new Engine({ seed: 1, level: s.options.level }), [s.options.level]);
  useEffect(() => { if (canvas.current) drawChicken(canvas.current, shown?.field ?? demo.view(), shown?.score ?? 0, shown?.tick ?? 0, s.status === 'waiting'); }, [s.status, shown, demo]);
  return <div className="ck-screen"><canvas width={480} height={640} ref={canvas} aria-label="Sân bắn gà" />{shown?.done && <div className="ck-overlay"><b>{shown.score} điểm</b><span>Đã kết thúc · đợt {shown.field.wave}</span></div>}</div>;
}

function LocalPlay({ s, me, room }: { s: ChickenView; me: ChickenPlayerView; room: ClientRoom }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const held = useRef(new Set<string>());
  const create = useCallback(() => new Engine({ seed: s.seed, level: s.options.level }), [s.seed, s.options.level]);
  const draw = useCallback((game: Engine) => { if (canvas.current) drawChicken(canvas.current, game.view(), game.score, game.tick, false); }, []);
  const { command, countdown, over } = useRaceLoop<Engine, ChickenCommand>({ me, gameNo: s.gameNo, tickMs: CHICKEN.TICK_MS, startAt: room.receivedAt + s.startIn, create, draw });
  const steer = useCallback(() => {
    const keys = held.current;
    command(keys.has('left') === keys.has('right') ? 'stop' : keys.has('left') ? 'left' : 'right');
  }, [command]);
  useEffect(() => { if (countdown === 0) steer(); }, [countdown, steer]);
  useEffect(() => {
    const direction = (key: string) => key === 'ArrowLeft' || key.toLowerCase() === 'a' ? 'left' : key === 'ArrowRight' || key.toLowerCase() === 'd' ? 'right' : null;
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.closest('input,textarea,select,[contenteditable]'))) return;
      const key = direction(e.key);
      if (key) { e.preventDefault(); held.current.add(key); steer(); }
    };
    const up = (e: KeyboardEvent) => { const key = direction(e.key); if (key) { held.current.delete(key); steer(); } };
    const release = () => { held.current.clear(); command('stop'); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
  }, [command, steer]);
  return <div className="ck-play"><div className="ck-screen"><canvas ref={canvas} width={480} height={640} aria-label="Dùng mũi tên trái phải để lái phi thuyền" />{countdown > 0 && <div className="ck-overlay"><b>{countdown}</b><span>Chuẩn bị xuất kích</span></div>}{over && <div className="ck-overlay"><b>Hết lượt!</b><span>Đang cập nhật kết quả…</span></div>}</div>
    <div className="ck-controls">{(['left', 'right'] as const).map((dir) => <button key={dir} className="btn" aria-label={dir === 'left' ? 'Sang trái' : 'Sang phải'} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); held.current.add(dir); steer(); }} onPointerUp={() => { held.current.delete(dir); steer(); }} onPointerCancel={() => { held.current.delete(dir); steer(); }} onLostPointerCapture={() => { held.current.delete(dir); steer(); }} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); held.current.add(dir); steer(); } }} onKeyUp={() => { held.current.delete(dir); steer(); }} onBlur={() => { held.current.delete(dir); steer(); }}>{dir === 'left' ? <ArrowLeft /> : <ArrowRight />}</button>)}</div>
  </div>;
}
