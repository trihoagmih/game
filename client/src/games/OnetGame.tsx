import { useEffect, useRef, useState } from 'react';
import { Lightbulb, Shuffle, Flag, Timer, Trophy } from 'lucide-react';
import { findPath } from '@game/shared/onet';
import type { Cell } from '@game/shared/onet';
import type { OnetPlayerView, OnetScoreView, OnetView } from '@game/shared/views';
import type { AppContextValue, Call, ClientRoom } from '../store.js';

type Act = AppContextValue['act'];
type Path = NonNullable<ReturnType<typeof findPath>>;
/** Đường nối vừa đi để vẽ thoáng qua; `cells`: hai ô vừa nối kèm hình [r, c, v]. */
interface Flash { path: Path; cells: [number, number, number][]; key: number }
import { useRoomApp } from '../store.js';
import { useCountdown, useHotkeys, fmtClock } from '../hooks.js';
import GameInfo from '../components/GameInfo.js';
import ConfirmDialog from '../components/ConfirmDialog.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog, { GoRanking } from '../components/GameOverDialog.js';
import { SPRITES, SPRITE_NAMES } from './onetSprites.js';
import './OnetGame.css';

// 36 hình thú (emoji) — chỉ số 1..36 khớp với giá trị ô trên server
const ANIMALS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
  '🐧', '🐦', '🐤', '🦆', '🦉', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐢', '🐍', '🐙', '🦀', '🐠', '🐬'];
// Mỗi loại một sắc nền nhẹ để dễ phân biệt (và để vẽ bàn thu nhỏ của người khác)
const hue = (v: number) => (v * 137) % 360;

// Kiểu hình: quái thú pixel cổ điển (mặc định) hoặc emoji — lưu theo từng máy
const SKIN_KEY = 'gl_onet_skin';
function useSkin() {
  const [skin, setSkin] = useState(() => { try { return localStorage.getItem(SKIN_KEY) || 'pixel'; } catch { return 'pixel'; } });
  const set = (v: string) => { setSkin(v); try { localStorage.setItem(SKIN_KEY, v); } catch { /* bỏ qua */ } };
  return [skin, set] as const;
}

/** Hình trên ô: quái pixel 16×16 phóng ×2, hoặc emoji. */
function TileArt({ v, skin }: {v: number; skin: string}) {
  if (skin === 'emoji') return <text x={CW / 2} y={CH / 2 + 1} className="onet-emoji">{ANIMALS[v - 1]}</text>;
  return (
    <g transform={`translate(${(CW - 32) / 2},${(CH - 5 - 32) / 2}) scale(2)`} className="onet-pixel" shapeRendering="crispEdges">
      {SPRITES[v - 1].map((x) => <path key={x.fill} fill={x.fill} d={x.d} />)}
    </g>
  );
}

const CW = 40; // bề rộng ô (đơn vị SVG)
const CH = 46; // chiều cao ô
const FLASH_MS = 380;
// Chế độ cổ điển: kiểu dồn hình của từng màn (khớp SHIFTS trong shared/src/onet.js)
export const SHIFT_LABEL: Record<string, string> = {
  none: 'Không dồn', down: 'Dồn xuống ↓', left: 'Dồn sang trái ←', up: 'Dồn lên ↑', right: 'Dồn sang phải →',
  vin: 'Dồn vào giữa ↕', hin: 'Dồn vào giữa ↔', vout: 'Tách lên – xuống', hout: 'Tách trái – phải',
};
const PORTRAIT = '(max-width: 640px) and (orientation: portrait)';

/** Màn dọc hẹp (điện thoại): vẽ bàn xoay ngang→dọc cho ô to hơn (chỉ đổi cách hiển thị). */
function usePortrait() {
  const [m, setM] = useState(() => !!window.matchMedia?.(PORTRAIT).matches);
  useEffect(() => {
    const q = window.matchMedia?.(PORTRAIT);
    if (!q) return undefined;
    const on = () => setM(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return m;
}

export default function OnetGame({ room, state: s }: { room: ClientRoom; state: OnetView }) {
  const { act, call, user } = useRoomApp();
  const playing = s.status === 'playing';
  const me = s.players.find((p) => p.id === s.myId) || null;
  const [watchId, setWatchId] = useState<string | null>(null);
  const shown = me || s.players.find((p) => p.id === watchId) || s.players[0] || null;
  const classic = s.options.mode === 'classic';
  // Cổ điển: mỗi người một đồng hồ theo màn; kiểu đua: một đồng hồ chung
  const clockRunning = playing && (!classic || (shown && !shown.done));
  const timeLeft = useCountdown(classic ? (shown?.timeLeft ?? 0) : s.timeLeft, room.receivedAt, clockRunning);
  const [giveup, setGiveup] = useState(false);
  const canPlay = playing && me && !me.done;
  const [skin, setSkin] = useSkin();

  useHotkeys({
    h: () => canPlay && (me.hintsLeft ?? 0) > 0 && act({ type: 'hint' }),
    s: () => canPlay && (me.shufflesLeft ?? 0) > 0 && act({ type: 'shuffle' }),
  });

  return (
    <div className="onet">
      <div className="onet-main">
        <Racers s={s} ownerId={room.ownerId} shownId={shown?.id} onPick={me ? null : setWatchId} />

        <div className="onet-bar">
          {classic && (
            <span className="onet-level" title={SHIFT_LABEL[shown?.shift || 'none']}>
              <span><span className="onet-tl">Màn </span><b>{shown && s.status !== 'waiting' ? shown.level : 1}</b>/{s.levels}</span>
              <span className="onet-shift">{SHIFT_LABEL[shown && s.status !== 'waiting' ? shown.shift : 'none']}</span>
            </span>
          )}
          <span className={`onet-time ${clockRunning && timeLeft < 30000 ? 'low' : ''}`}>
            <Timer size={15} aria-hidden /> {playing ? fmtClock(timeLeft) : fmtClock(s.timeTotal)}
          </span>
          <div className="onet-timebar" aria-hidden>
            <div style={{ width: `${playing ? (timeLeft / s.timeTotal) * 100 : 100}%` }} />
          </div>
          {shown && s.status !== 'waiting' && (
            <span className="onet-score"><b>{shown.score}</b><span className="onet-score-unit"> điểm</span>{shown.combo > 1 && playing && !shown.done && <span className="onet-combo"> ×{shown.combo}</span>}</span>
          )}
          {canPlay && (
            <span className="onet-tools">
              <button className="btn sm" disabled={(me.hintsLeft ?? 0) <= 0} onClick={() => act({ type: 'hint' })} title="Gợi ý (H)" aria-label={`Gợi ý, còn ${me.hintsLeft}`}>
                <Lightbulb size={15} aria-hidden /> <span className="onet-tl">Gợi ý</span> {me.hintsLeft}
              </button>
              <button className="btn sm" disabled={(me.shufflesLeft ?? 0) <= 0} onClick={() => act({ type: 'shuffle' })} title="Đổi hình (S)" aria-label={`Đổi hình, còn ${me.shufflesLeft}`}>
                <Shuffle size={15} aria-hidden /> <span className="onet-tl">Đổi hình</span> {me.shufflesLeft}
              </button>
              <button className="btn sm danger" onClick={() => setGiveup(true)} title="Bỏ cuộc" aria-label="Bỏ cuộc"><Flag size={15} aria-hidden /></button>
            </span>
          )}
        </div>

        <div className="panel onet-stage">
          {shown && s.status !== 'waiting' ? (
            <Board key={`${s.gameNo}-${shown.id}-${shown.level}`} p={shown} rows={s.options.rows} cols={s.options.cols}
              interactive={!!canPlay} act={act} skin={skin} />
          ) : (
            <div className="onet-wait">
              <div className="onet-big">🐾 Nối thú</div>
              <div className="muted">Chọn hai ô cùng hình nối được bằng đường gấp khúc tối đa 3 đoạn (≤ 2 lần rẽ).</div>
              <div className="muted small">Chờ mọi người sẵn sàng, chủ phòng bấm Bắt đầu</div>
            </div>
          )}
          {classic && playing && !shown?.done && shown?.level > 1 && (
            <div key={`lv-${shown.id}-${shown.level}`} className="onet-levelup" aria-live="polite">
              Màn {shown.level} · {SHIFT_LABEL[shown.shift]}
            </div>
          )}
          {playing && me?.done && (
            <div className="onet-done">{me.gaveUp ? 'Bạn đã bỏ cuộc' : me.timedOut ? `⏰ Hết giờ ở màn ${me.level} — chờ mọi người…`
              : `🎉 ${classic ? 'Phá đảo' : 'Dọn sạch'} sau ${fmtClock(me.finishedAt ?? 0)} — chờ mọi người…`}</div>
          )}
        </div>

        {s.status === 'over' && s.result && <Result s={s} me={user.id} call={call} />}

        {s.status !== 'over' && (!playing || !s.myId) && <div className="board-actions">
          {!playing && (s.myId ? (
            <>
              <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated min={1}
                startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />
              <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            </>
          ) : (
            <>
              <span className="muted small ba-note">
                Bạn đang xem.{' '}
                {s.seats.length < s.options.maxSeats && <button className="btn primary sm" onClick={() => call('room:sit', {})}>Vào chơi</button>}
              </span>
              <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={false} min={1}
                startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />
            </>
          ))}
          {playing && !s.myId && <span className="muted small">Bạn đang xem — bấm vào tên người chơi để xem bàn của họ</span>}
        </div>}

        {giveup && (
          <ConfirmDialog title="Bỏ cuộc ván này?" danger okLabel="Bỏ cuộc" icon={<Flag size={22} />}
            onOk={() => act({ type: 'giveup' })} onClose={() => setGiveup(false)}>
            Điểm hiện tại được giữ, nhưng bạn xếp sau những người còn chơi tới hết.
          </ConfirmDialog>
        )}
      </div>

      <GameInfo>
        <Wins wins={s.wins} me={user.id} />
        <div className="panel small onet-skin">
          <b>Kiểu hình</b>
          <div className="onet-skin-btns" role="radiogroup" aria-label="Kiểu hình">
            <button type="button" role="radio" aria-checked={skin === 'pixel'} className={`btn sm ${skin === 'pixel' ? 'primary' : 'ghost'}`} onClick={() => setSkin('pixel')}>👾 Pixel cổ điển</button>
            <button type="button" role="radio" aria-checked={skin === 'emoji'} className={`btn sm ${skin === 'emoji' ? 'primary' : 'ghost'}`} onClick={() => setSkin('emoji')}>🐶 Emoji</button>
          </div>
        </div>
        <div className="panel small muted">
          <b>Luật chơi</b>
          <ul>
            <li>Chọn hai ô <b>cùng hình</b>. Chúng biến mất nếu nối được bằng đường gấp khúc tối đa <b>3 đoạn thẳng</b> (≤ 2 lần rẽ), chỉ đi qua ô trống — được vòng ra <b>ngoài viền</b> bàn.</li>
            {classic ? <>
              <li><b>Cổ điển:</b> vượt lần lượt {s.levels} màn, mỗi màn {s.options.minutes} phút. Hết giờ ở màn nào thì dừng ở màn đó.</li>
              <li>Từ màn 2, sau mỗi lần nối các hình <b>dồn</b> theo một hướng: xuống, trái, lên, phải, vào giữa, tách ra hai bên…</li>
              <li>Mọi người gặp <b>cùng một bàn</b> ở mỗi màn. Xếp hạng theo màn đạt được, rồi tới điểm.</li>
            </> : (
              <li>Mọi người chơi <b>cùng một bàn</b> (mỗi người một bản). Ai dọn sạch trước thắng; hết {s.options.minutes} phút thì xếp theo điểm.</li>
            )}
            <li>Mỗi cặp 10 điểm, nối liên tiếp trong 3 giây được <b>combo</b> +2/bậc. Dọn sạch bàn được thưởng 1 điểm cho mỗi giây còn lại.</li>
            <li>{s.options.hints} lượt gợi ý, {s.options.shuffles} lượt đổi hình{classic ? ' (qua mỗi màn được thêm 1 lượt đổi hình)' : ''}. Hết nước đi thì bàn <b>tự xáo</b> miễn phí.</li>
            {s.options.gravity && <li><b>Trọng lực:</b> nối xong, các hình phía trên rơi xuống lấp chỗ trống.</li>}
          </ul>
        </div>
      </GameInfo>
    </div>
  );
}

function Board({ p, rows, cols, interactive, act, skin }: {
  p: OnetPlayerView; rows: number; cols: number; interactive: boolean; act: Act; skin: string;
}) {
  const [sel, setSel] = useState<Cell | null>(null); // [r,c]
  const [bad, setBad] = useState<Cell[] | null>(null); // hai ô vừa chọn sai (rung)
  const [flash, setFlash] = useState<Flash | null>(null);
  const [pending, setPending] = useState<Cell[] | null>(null); // hai ô đang chờ server xác nhận (ẩn trước cho mượt)
  const seqRef = useRef(p.seq);
  const tr = usePortrait() && cols > rows;
  // Vị trí hiển thị của ô (r,c): bàn xoay thì hàng ↔ cột
  const at = (r: number, c: number) => (tr ? [c, rows - 1 - r] : [r, c]);
  const W = ((tr ? rows : cols) + 2) * CW;
  const H = ((tr ? cols : rows) + 2) * CH;
  const xy = (r: number, c: number) => { const [y, x] = at(r, c); return [(x + 1) * CW, (y + 1) * CH]; };

  // Server đã cập nhật bàn → bỏ ẩn tạm, bỏ chọn nếu ô đã đổi
  useEffect(() => {
    if (p.seq === seqRef.current) return;
    seqRef.current = p.seq;
    setPending(null);
    setSel((x) => (x && p.grid[x[0]][x[1]] ? x : null));
    // Người khác đang xem bàn này: vẽ đường nối của nước vừa đi
    if (!interactive && p.last?.path) {
      setFlash({ path: p.last.path, cells: [], key: p.last.seq });
    }
  }, [p.seq, p.grid, p.last, interactive]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!bad) return;
    const t = setTimeout(() => setBad(null), 300);
    return () => clearTimeout(t);
  }, [bad]);
  useEffect(() => { if (!interactive) setSel(null); }, [interactive]);

  useHotkeys({ Escape: () => setSel(null) });

  const hidden = (r: number, c: number) => pending?.some(([pr, pc]) => pr === r && pc === c);
  const grid: number[][] = pending ? p.grid.map((row, r) => row.map((v, c) => (hidden(r, c) ? 0 : v))) : p.grid;

  const click = async (r: number, c: number) => {
    if (!interactive || !grid[r][c]) return;
    if (!sel) return setSel([r, c]);
    if (sel[0] === r && sel[1] === c) return setSel(null);
    if (grid[sel[0]][sel[1]] !== grid[r][c]) return setSel([r, c]);
    const path = findPath(grid, sel, [r, c]);
    if (!path) {
      setBad([sel, [r, c]]);
      setSel(null);
      return;
    }
    const a = sel, b: Cell = [r, c];
    setFlash({ path, cells: [[...a, grid[a[0]][a[1]]], [...b, grid[r][c]]], key: Date.now() });
    setSel(null);
    setPending([a, b]);
    const res = await act({ type: 'match', a, b });
    if (!res) setPending(null);
  };

  const hint = p.hint || null;
  const isHint = (r: number, c: number) => hint?.some(([hr, hc]) => hr === r && hc === c);
  const isBad = (r: number, c: number) => bad?.some(([br, bc]) => br === r && bc === c);
  const pt = ([r, c]: readonly number[]) => { const [x, y] = xy(r, c); return `${x + CW / 2},${y + CH / 2}`; };

  return (
    <svg className={`onet-board ${skin === 'pixel' ? 'pixel' : ''}`} viewBox={`0 0 ${W} ${H}`} role="grid" aria-label={`Bàn của ${p.name}, còn ${p.left} ô`}>
      {grid.map((row, r) => row.map((v, c) => v ? (
        <g key={`${r}-${c}`} className={`onet-tile ${sel && sel[0] === r && sel[1] === c ? 'sel' : ''} ${isHint(r, c) ? 'hint' : ''} ${isBad(r, c) ? 'bad' : ''}`}
          transform={`translate(${xy(r, c).join(',')})`} onClick={() => click(r, c)} role="gridcell"
          aria-label={`Hàng ${r + 1} cột ${c + 1}${skin === 'pixel' ? `: ${SPRITE_NAMES[v - 1]}` : ''}`}>
          <g className="onet-in">
            <rect x="1.5" y="1.5" width={CW - 3} height={CH - 3} rx="6" className="onet-tile-face"
              style={{ fill: skin === 'pixel' ? `hsl(${hue(v)} 45% 95%)` : `hsl(${hue(v)} 70% 92%)` }} />
            <rect x="1.5" y={CH - 7} width={CW - 3} height="5.5" rx="2" className="onet-tile-edge" />
            <TileArt v={v} skin={skin} />
          </g>
        </g>
      ) : null))}
      {flash && (
        <g key={flash.key} className="onet-flash" pointerEvents="none">
          {flash.cells.map(([r, c, v]) => (
            <g key={`${r}-${c}`} transform={`translate(${xy(r, c).join(',')})`} className="onet-gone">
              <rect x="1.5" y="1.5" width={CW - 3} height={CH - 3} rx="6" className="onet-tile-face sel-face" />
              <TileArt v={v} skin={skin} />
            </g>
          ))}
          <polyline points={flash.path.map(pt).join(' ')} className="onet-path" />
        </g>
      )}
    </svg>
  );
}

function Racers({ s, ownerId, shownId, onPick }: { s: OnetView; ownerId: string; shownId: string | undefined; onPick: ((id: string) => void) | null }) {
  const total = s.options.rows * s.options.cols;
  type Racer = Pick<OnetPlayerView, 'id' | 'name' | 'left' | 'score' | 'done'> & Partial<Pick<OnetPlayerView, 'gaveUp' | 'timedOut' | 'level'>>;
  const list: Racer[] = s.status === 'waiting' || !s.players.length
    ? s.seats.map((x) => ({ ...x, left: total, score: 0, done: false }))
    : s.players;
  return (
    <div className="onet-racers">
      {list.map((p) => {
        const pct = ((total - p.left) / total) * 100;
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag key={p.id} className={`onet-racer ${p.id === s.myId ? 'me' : ''} ${p.id === shownId && onPick ? 'shown' : ''} ${p.gaveUp ? 'out' : ''}`}
            {...(onPick ? { type: 'button', onClick: () => onPick(p.id) } : {})}>
            <div className="onet-rname">
              {p.name}{p.id === s.myId && <span className="muted"> (bạn)</span>}
              {s.status !== 'playing' && <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />}
            </div>
            <div className="small muted">
              {s.options.mode === 'classic' && p.level && s.status !== 'waiting' ? `Màn ${p.level} · ` : ''}
              {p.gaveUp ? 'Bỏ cuộc' : p.timedOut ? 'Hết giờ' : p.done ? '✅ Xong' : `Còn ${p.left} ô`} · <b className="onet-pts">{p.score}</b> điểm
            </div>
            <div className="onet-progress"><div style={{ width: `${pct}%` }} /></div>
          </Tag>
        );
      })}
      {list.length === 0 && <div className="muted small">Chưa có ai ngồi</div>}
    </div>
  );
}

function Result({ s, me, call }: { s: OnetView; me: string; call: Call }) {
  const byId = (id: string | null) => s.players.find((p) => p.id === id);
  const result = s.result;
  if (!result) return null;
  const winner = byId(result.winner);
  const solo = s.players.length === 1;
  const classic = s.options.mode === 'classic';
  const title = solo
    ? (s.players[0].finishedAt != null ? (classic ? `🎉 Phá đảo ${s.levels} màn!` : '🎉 Dọn sạch bàn!')
      : s.players[0].gaveUp ? (classic ? `🏳️ Bỏ cuộc ở màn ${s.players[0].level}` : '🏳️ Đã bỏ cuộc') : classic ? `⏰ Dừng ở màn ${s.players[0].level}` : '⏰ Hết giờ!')
    : winner ? <>🏆 {winner.id === me ? 'Bạn' : winner.name} thắng!</> : 'Không ai thắng';
  const rows = result.ranking.map((id) => byId(id)).filter((p) => p != null).map((p) => {
    const id = p.id;
    const note = `${classic && p.finishedAt == null ? `màn ${p.level} · ` : ''}${p.finishedAt != null ? `xong ${fmtClock(p.finishedAt)} (+${p.bonus})` : p.gaveUp ? 'bỏ cuộc' : `còn ${p.left} ô`}`;
    return { id, name: p.name, value: p.score, note };
  });
  return (
    <GameOverDialog over icon={<Trophy size={26} />} title={title} min={1}
      seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!s.myId} reviewLabel="Xem lại bàn"
      seatBtn={s.myId ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
        : s.seats.length < s.options.maxSeats && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>}>
      <GoRanking me={me} rows={rows} />
    </GameOverDialog>
  );
}

function Wins({ wins, me }: { wins: OnetScoreView[]; me: string }) {
  if (!wins.length) return null;
  return (
    <div className="panel">
      <h4>Bảng thành tích</h4>
      <table className="sb-table">
        <thead><tr><th>#</th><th>Người chơi</th><th>Ván</th><th>Thắng</th><th>Dọn sạch</th><th>Cao nhất</th></tr></thead>
        <tbody>
          {wins.map((w, i) => (
            <tr key={w.id} className={w.id === me ? 'me' : ''}>
              <td>{i === 0 && w.wins > 0 ? <Trophy size={14} aria-label="Dẫn đầu" /> : i + 1}</td>
              <td className="sb-name">{w.name}</td>
              <td>{w.games}</td>
              <td><b>{w.wins}</b></td>
              <td>{w.clears}</td>
              <td>{w.best}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
