import { Check, Citrus, Mic, Repeat, SkipForward, Square, Timer, Trophy, Wheat, X } from 'lucide-react';
import { LEVEL_NAMES, TEAM_NAMES } from '@game/shared/twister';
import type { TeamIndex, TwisterCurrentView, TwisterTurnView, TwisterView, Verdict } from '@game/shared/twister';
import { useRoomApp } from '../store.js';
import type { ClientRoom } from '../store.js';
import { useCountdown, useHotkeys } from '../hooks.js';
import GameInfo from '../components/GameInfo.js';
import StartBar, { ReadyMark } from '../components/StartBar.js';
import GameOverDialog from '../components/GameOverDialog.js';
import './TwisterGame.css';

const TEAM_ICONS = [Wheat, Citrus] as const;
const TEAMS: TeamIndex[] = [0, 1];

export default function TwisterGame({ room, state: s }: { room: ClientRoom; state: TwisterView }) {
  const { act, call, user } = useRoomApp();
  const me = s.myId;
  const playing = s.status === 'playing';
  const cur = s.current;
  const left = useCountdown(s.phaseLeft, room.receivedAt, playing);
  const isReader = !!cur && cur.readerId === me && cur.phase === 'read';
  const isOwner = room.ownerId === user.id;
  const vote = (verdict: Verdict) => () => { if (cur?.canVote) act({ type: 'twisterVote', verdict, turn: s.turnNo }); };
  useHotkeys({
    Enter: () => { if (isReader) act({ type: 'next' }); },
    1: vote('clean'),
    2: vote('slip'),
  });
  const over = s.status === 'over' && !!s.result;
  const r = s.result;
  const canSit = !playing && !me && s.seats.length < s.options.maxSeats;

  return (
    <div className="tw">
      <div className="tw-main">
        <GameOverDialog over={over} icon={<Trophy size={26} />}
          title={r?.winner == null ? 'Hòa!' : `${TEAM_NAMES[r.winner]} thắng!`}
          detail={r ? `${TEAM_NAMES[0]} ${r.scores[0]} – ${r.scores[1]} ${TEAM_NAMES[1]}${r.reason === 'forfeit' ? ' · đội kia hết người' : r.reason === 'stopped' ? ' · chủ phòng dừng ván' : ''}` : null}
          seats={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!me} min={s.minPlayers}
          seatBtn={me ? <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>
            : canSit && <button className="btn primary" onClick={() => call('room:sit', {})}>Vào chơi</button>} />

        <div className="tw-teams">
          {TEAMS.map((t) => <TeamCard key={t} team={t} s={s} ownerId={room.ownerId}
            onJoin={!playing && (me ? s.seats.find((x) => x.id === me)?.team !== t : canSit)
              ? () => (me ? act({ type: 'twisterTeam', team: t }) : call('room:sit', { seat: t })) : null} />)}
        </div>

        <section className={`panel tw-stage ${isReader ? 'my-turn' : ''}`} aria-live="polite">
          {cur ? <Turn s={s} cur={cur} left={left} me={me} onVote={(v) => vote(v)()}
            onDone={() => act({ type: 'next' })} onSkip={() => act({ type: 'pass' })} />
            : <Intro s={s} />}
        </section>

        {!over && <div className="board-actions">
          {!playing && <StartBar players={s.seats} ready={s.ready} waitingFor={s.waitingFor} seated={!!me} min={s.minPlayers}
            startLabel={s.status === 'over' ? 'Chơi ván mới' : 'Bắt đầu'} />}
          {me && !playing && <button className="btn ghost" onClick={() => call('room:stand', {})}>Đứng dậy</button>}
          {!me && <span className="muted small ba-note">Bạn đang xem.{canSit && <> Chọn đội ở trên để vào chơi.</>}</span>}
          {playing && isOwner && <button className="btn ghost sm" onClick={() => act({ type: 'stop' })}><Square size={14} aria-hidden /> Dừng ván</button>}
        </div>}
      </div>

      <GameInfo>
        <Log log={s.log} />
        {s.wins.some((w) => w > 0) && (
          <div className="panel tw-wins">
            <h4>Số ván thắng</h4>
            {TEAMS.map((t) => <div key={t} className={`tw-win t${t}`}><TeamName team={t} /><b>{s.wins[t]}</b></div>)}
          </div>
        )}
        <div className="panel small muted wc-rules">
          <b>Luật chơi</b>
          <ul>
            <li>Hai đội thay phiên, mỗi lượt <b>một người đọc to</b> câu líu lưỡi trên màn hình (mở mic hoặc ngồi cạnh nhau).</li>
            <li>Câu có nhãn <b>×2, ×3</b> phải đọc liền chừng ấy lần. Đọc xong bấm <b>Đọc xong</b> (Enter) trong {s.options.readSeconds} giây.</li>
            <li>Mọi người còn lại chấm <b>Chuẩn</b> (phím 1) hoặc <b>Vấp</b> (phím 2) — chấm được ngay khi đang nghe. Chuẩn nhiều hơn hoặc bằng Vấp là đọc chuẩn.</li>
            <li>Đọc chuẩn được điểm theo độ khó: Khởi động 1 · Khó 2 · Siêu khó 3. Bỏ qua thì 0 điểm.</li>
            <li>Mỗi người đọc khoảng {s.options.rounds} câu. Hết lượt, đội nhiều điểm hơn thắng. Bộ có sẵn {s.bankSize} câu, ít lặp lại trong phòng.</li>
          </ul>
        </div>
      </GameInfo>
    </div>
  );
}

function TeamName({ team }: { team: TeamIndex }) {
  const Icon = TEAM_ICONS[team];
  return <span className="tw-team-name"><Icon size={16} aria-hidden /> {TEAM_NAMES[team]}</span>;
}

function TeamCard({ team, s, ownerId, onJoin }: { team: TeamIndex; s: TwisterView; ownerId: string; onJoin: (() => void) | null }) {
  const playing = s.status === 'playing';
  // Đang chơi: đội của ván; ngoài ván: chỗ ngồi hiện tại kèm thành tích ván vừa xong (nếu có)
  const list = (playing ? s.players : s.seats.map((x) => ({ reads: 0, clean: 0, ...s.players.find((p) => p.id === x.id), ...x, gone: false })))
    .filter((p) => p.team === team);
  const turnTeam = playing && s.current?.team === team;
  return (
    <div className={`tw-team t${team} ${turnTeam ? 'turn' : ''}`}>
      <div className="tw-team-head">
        <TeamName team={team} />
        <span className="tw-score" aria-label={`${s.scores[team]} điểm`}>{s.status === 'waiting' ? '' : s.scores[team]}</span>
      </div>
      <ul className="tw-members">
        {list.map((p) => (
          <li key={p.id} className={`${p.id === s.current?.readerId ? 'reading' : ''} ${p.gone ? 'gone' : ''} ${p.id === s.myId ? 'me' : ''}`}>
            {p.id === s.current?.readerId && <Mic size={12} aria-label="đang đọc" />}
            <span className="tw-member-name">{p.name}</span>
            {s.status !== 'waiting' && p.reads > 0 && <span className="tw-member-stat">{p.clean}/{p.reads}</span>}
            {!playing && <ReadyMark id={p.id} ready={s.ready} ownerId={ownerId} />}
          </li>
        ))}
        {!list.length && <li className="muted">Chưa có ai</li>}
      </ul>
      {onJoin && <button className="btn sm tw-join" onClick={onJoin}>{s.myId ? 'Sang đội này' : 'Vào đội này'}</button>}
    </div>
  );
}

function Intro({ s }: { s: TwisterView }) {
  return (
    <div className="tw-intro">
      <Mic size={30} aria-hidden className="tw-intro-icon" />
      <div className="tw-intro-title">Líu lưỡi</div>
      <p className="tw-line sample">Lúa nếp là lúa nếp làng, lúa lên lớp lớp lòng nàng lâng lâng.</p>
      <p className="muted small">
        {s.seats.length < s.minPlayers ? 'Cần ít nhất 2 người, mỗi đội ít nhất 1 người.'
          : 'Chia đội xong, mọi người sẵn sàng thì chủ phòng bấm Bắt đầu. Nên bật mic để cả phòng nghe!'}
      </p>
    </div>
  );
}

function Turn({ s, cur, left, me, onVote, onDone, onSkip }: {
  s: TwisterView; cur: TwisterCurrentView; left: number; me: string | null;
  onVote: (v: Verdict) => void; onDone: () => void; onSkip: () => void;
}) {
  const reader = s.players.find((p) => p.id === cur.readerId);
  const mine = cur.readerId === me;
  const sec = Math.ceil(left / 1000);
  return (
    <div className={`tw-turn t${cur.team}`}>
      <div className="tw-turn-head">
        <span className="tw-progress">Lượt {Math.min(s.turn + 1, s.totalTurns)}/{s.totalTurns}</span>
        <span className={`tw-level l${cur.level}`}>{LEVEL_NAMES[cur.level]} · {cur.level}đ</span>
        {cur.lang === 'en' && <span className="tw-lang">Tiếng Anh</span>}
        {cur.repeat > 1 && <span className="tw-repeat"><Repeat size={13} aria-hidden /> đọc ×{cur.repeat}</span>}
        <span className={`tw-time ${left < 5000 && cur.phase !== 'result' ? 'low' : ''}`}><Timer size={14} aria-hidden /> {sec}s</span>
      </div>
      <div className="timebar"><div style={{ width: `${s.phaseTotal ? (left / s.phaseTotal) * 100 : 0}%` }} /></div>
      <div className="tw-reader">
        <Mic size={15} aria-hidden />
        {mine ? <b>Đến lượt bạn đọc to!</b> : <span><b>{reader?.name ?? '?'}</b> ({TEAM_NAMES[cur.team]}) {cur.phase === 'read' ? 'đang đọc' : 'đã đọc'}</span>}
      </div>
      <p className="tw-line" lang={cur.lang}>{cur.text}</p>
      <div className="tw-actions">
        {cur.phase === 'result' && cur.outcome ? <Outcome o={cur.outcome} />
          : mine && cur.phase === 'read' ? (
            <>
              <button className="btn cta tw-big" onClick={onDone}><Check size={18} aria-hidden /> Đọc xong</button>
              <button className="btn ghost tw-big" onClick={onSkip}><SkipForward size={18} aria-hidden /> Bỏ qua</button>
            </>
          ) : cur.canVote ? (
            <>
              <button className={`btn tw-big tw-vote clean ${cur.myVote === 'clean' ? 'on' : ''}`} aria-pressed={cur.myVote === 'clean'} onClick={() => onVote('clean')}>
                <Check size={18} aria-hidden /> Chuẩn
              </button>
              <button className={`btn tw-big tw-vote slip ${cur.myVote === 'slip' ? 'on' : ''}`} aria-pressed={cur.myVote === 'slip'} onClick={() => onVote('slip')}>
                <X size={18} aria-hidden /> Vấp
              </button>
            </>
          ) : <span className="muted small">{mine ? 'Chờ mọi người chấm…' : 'Đang nghe…'}</span>}
      </div>
      {cur.phase !== 'result' && (
        <div className="muted small tw-votes">
          {cur.phase === 'judge' ? 'Chấm đi! ' : ''}Đã chấm {cur.voted.length}/{cur.voters}
        </div>
      )}
    </div>
  );
}

function Outcome({ o }: { o: TwisterTurnView }) {
  if (o.outcome === 'skip') return <div className="tw-outcome skip"><SkipForward size={18} aria-hidden /> Bỏ qua — 0 điểm</div>;
  const clean = o.outcome === 'clean';
  return (
    <div className={`tw-outcome ${o.outcome}`}>
      {clean ? <Check size={20} aria-hidden /> : <X size={20} aria-hidden />}
      {clean ? `Chuẩn! +${o.points} cho ${TEAM_NAMES[o.team]}` : 'Vấp rồi! 0 điểm'}
      <span className="muted small">({o.clean} chuẩn · {o.slip} vấp)</span>
    </div>
  );
}

function Log({ log }: { log: TwisterTurnView[] }) {
  return (
    <div className="panel tw-log">
      <h4>Các lượt đã đọc</h4>
      {!log.length ? <div className="muted small">Chưa có lượt nào</div> : (
        <ol>
          {[...log].reverse().map((o) => (
            <li key={o.no} className={`t${o.team} ${o.outcome}`}>
              <div className="tw-log-head">
                <span className="tw-log-who">{o.no}. {o.readerName}</span>
                <span className="tw-log-res">
                  {o.outcome === 'clean' ? <><Check size={13} aria-hidden /> +{o.points}</> : o.outcome === 'slip' ? <><X size={13} aria-hidden /> Vấp</> : 'Bỏ qua'}
                </span>
              </div>
              <div className="tw-log-text" lang={o.lang}>{o.text}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
