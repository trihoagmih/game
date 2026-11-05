import { useEffect, useRef, useState } from 'react';
import { Check, Flag, RotateCcw, ThumbsDown } from 'lucide-react';
import { useApp } from '../store.jsx';
import { useCountdown } from '../hooks.js';

export default function WordChainGame({ room, state: s }) {
  const { act, call, user } = useApp();
  const g = s.game;
  const me = s.myId;
  const playing = s.status === 'playing';
  const myTurn = playing && g?.currentId === me;
  const timeLeft = useCountdown(s.turnLeft, room.receivedAt, playing);
  const last = g?.chain[g.chain.length - 1];
  const meInGame = g?.players.find((p) => p.id === me);
  const canObject = playing && last && meInGame && !meInGame.out && last.by !== me;
  const objected = g?.objections.includes(me);
  const nameOf = (id) => g?.players.find((p) => p.id === id)?.name || s.seats.find((x) => x.id === id)?.name || '?';

  return (
    <div className="wc">
      <div className="wc-main">
        <PlayerRow s={s} timeLeft={timeLeft} />

        <div className={`panel wc-stage ${myTurn ? 'my-turn' : ''}`}>
          {!g || s.status === 'waiting' ? (
            <div className="wc-wait">
              <div className="wc-big">🔤 Nối từ</div>
              <div className="muted">
                {s.seats.length < 2 ? 'Cần ít nhất 2 người chơi…' : 'Chờ tất cả bấm Sẵn sàng để bắt đầu'}
              </div>
            </div>
          ) : (
            <>
              {last ? (
                <div className="wc-word">
                  <span className="wc-syl">{last.syllables[0]}</span>{' '}
                  <span className="wc-syl key">{last.syllables[1]}</span>
                  <div className="muted small">#{g.total} · {last.name}</div>
                </div>
              ) : (
                <div className="wc-word empty">
                  <span className="muted">Chưa có từ nào</span>
                </div>
              )}

              {s.status === 'over' && g.result ? (
                <div className="wc-result">
                  <div className="wc-big">🏆 {g.result.winner ? `${nameOf(g.result.winner)} thắng!` : 'Hòa'}</div>
                  <div className="muted small">
                    Xếp hạng: {g.result.ranking.map((id, i) => `${i + 1}. ${nameOf(id)}`).join(' · ')} — {g.total} từ
                  </div>
                </div>
              ) : (
                <div className="wc-turn">
                  {myTurn ? <b className="your-turn">Tới lượt bạn!</b> : <>Lượt của <b>{nameOf(g.currentId)}</b></>}
                  {g.required ? <> — bắt đầu bằng <b className="wc-req">{g.required}</b></> : <> — ra từ đầu tiên</>}
                  <span className={`wc-time ${timeLeft < 5000 ? 'low' : ''}`}>⏱ {Math.ceil(timeLeft / 1000)}s</span>
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

        {g && <Chain chain={g.chain} total={g.total} me={me} />}
      </div>

      <div className="wc-side">
        <div className="panel">
          {me ? (
            <div className="xq-actions">
              {!playing && (
                <button className={`btn ${s.ready.includes(me) ? '' : 'primary'}`} onClick={() => act({ type: 'ready' })}
                  disabled={s.seats.length < 2}>
                  {s.ready.includes(me) ? 'Hủy sẵn sàng' : s.status === 'over' ? <><RotateCcw size={16} aria-hidden /> Chơi ván mới</> : <><Check size={16} aria-hidden /> Sẵn sàng</>}
                </button>
              )}
              {playing && meInGame && !meInGame.out && (
                <button className="btn danger" onClick={() => confirm('Chịu thua ván này?') && act({ type: 'giveup' })}><Flag size={16} aria-hidden /> Chịu thua</button>
              )}
              {!playing && <button className="btn ghost" onClick={() => call('room:stand')}>Đứng dậy xem</button>}
            </div>
          ) : (
            <div className="muted small">
              Bạn đang xem.{' '}
              {!playing && s.seats.length < s.options.maxSeats && (
                <button className="btn primary sm" onClick={() => call('room:sit', {})}>Vào chơi</button>
              )}
            </div>
          )}
          {!playing && s.seats.length >= 2 && (
            <div className="muted small" style={{ marginTop: 8 }}>
              Sẵn sàng: {s.ready.length}/{s.seats.length}
            </div>
          )}
        </div>
        <Wins wins={s.wins} me={user.id} />
        <div className="panel small muted wc-rules">
          <b>Luật chơi</b>
          <ul>
            <li>Mỗi từ gồm <b>2 chữ</b>, chữ đầu phải trùng chữ cuối của từ trước: <i>con mèo → mèo con → con đường</i>.</li>
            <li>Không lặp lại từ đã dùng trong ván.{s.options.dictionary && ' Mỗi chữ phải có trong từ điển tiếng Việt.'}</li>
            <li>Mỗi lượt {s.options.turnSeconds} giây. Hết giờ mất 1 mạng (có {s.options.lives} mạng), hết mạng bị loại.</li>
            <li>Từ vô nghĩa? Bấm <b>vô nghĩa</b>: quá nửa số người còn lại phản đối thì từ bị gỡ, người đó nối lại.</li>
            <li>Người cuối cùng còn lại thắng.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function WordInput({ required, act }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { setText(''); ref.current?.focus(); }, [required]);

  const submit = async (e) => {
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
      <input ref={ref} autoFocus value={text} maxLength={required ? 12 : 24} disabled={busy}
        onChange={(e) => setText(required ? e.target.value.replace(/\s/g, '') : e.target.value)}
        placeholder={required ? 'chữ thứ hai…' : 'từ đầu tiên, vd: con mèo'} autoComplete="off" autoCapitalize="off" spellCheck={false} />
      <button className="btn primary" disabled={!text.trim() || busy}>Nối ↵</button>
    </form>
  );
}

function PlayerRow({ s, timeLeft }) {
  const g = s.game;
  const list = g && s.status !== 'waiting' ? g.players : s.seats.map((x) => ({ ...x, lives: s.options.lives, out: false, words: 0 }));
  return (
    <div className="wc-players">
      {list.map((p) => {
        const turn = s.status === 'playing' && g?.currentId === p.id;
        return (
          <div key={p.id} className={`wc-player ${turn ? 'turn' : ''} ${p.out ? 'out' : ''} ${p.id === s.myId ? 'me' : ''}`}>
            <div className="wc-pname">{p.name}{p.id === s.myId && <span className="muted"> (bạn)</span>}</div>
            <div className="small">
              {p.out ? <span className="muted">Bị loại</span> : <span className="wc-lives">{'♥'.repeat(p.lives)}</span>}
              {g && s.status !== 'waiting' && <span className="muted"> · {p.words} từ</span>}
              {s.status !== 'playing' && s.ready.includes(p.id) && <span className="ready"> ✔</span>}
            </div>
            {turn && <div className="timebar"><div style={{ width: `${(timeLeft / s.turnTotal) * 100}%` }} /></div>}
          </div>
        );
      })}
      {list.length === 0 && <div className="muted small">Chưa có ai ngồi</div>}
    </div>
  );
}

function Chain({ chain, total, me }) {
  return (
    <div className="panel wc-chain">
      <h4>Chuỗi từ ({total})</h4>
      {chain.length === 0 ? <div className="muted small">Chưa có từ nào</div> : (
        <ol reversed start={total}>
          {chain.slice().reverse().map((w, i) => (
            <li key={total - i} className={w.by === me ? 'mine' : ''}>
              <span className="wc-chain-word">{w.text}</span> <span className="muted small">— {w.name}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Wins({ wins, me }) {
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
