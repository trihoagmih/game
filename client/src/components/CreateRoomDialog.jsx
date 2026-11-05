import { useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from './Modal.jsx';
import { GAME_META, GameIcon } from './Lobby.jsx';

const DEFAULTS = {
  xiangqi: { minutes: 8 },
  caro: { size: 15, minutes: 10, blockTwoEnds: true },
  wordchain: { maxSeats: 6, turnSeconds: 20, lives: 1, dictionary: true },
  poker: { smallBlind: 10, bigBlind: 20, buyIn: 2000, maxSeats: 6, turnSeconds: 30, rabbitHunt: true },
  tala: { maxSeats: 4, unit: 10, turnSeconds: 30 },
  samloc: { maxSeats: 4, unit: 10, turnSeconds: 25 },
};

const FIELDS = {
  xiangqi: [['minutes', 'Thời gian mỗi bên (phút)', 1, 60]],
  wordchain: [
    ['maxSeats', 'Số người chơi tối đa', 2, 8],
    ['turnSeconds', 'Thời gian mỗi lượt (giây)', 10, 60],
    ['lives', 'Số mạng mỗi người', 1, 3],
    ['dictionary', 'Kiểm tra từ điển (mỗi chữ phải là tiếng Việt)', 'bool'],
  ],
  caro: [
    ['size', 'Kích thước bàn (ô mỗi cạnh)', 10, 20],
    ['minutes', 'Thời gian mỗi bên (phút)', 1, 60],
    ['blockTwoEnds', 'Chặn hai đầu thì không tính thắng', 'bool'],
  ],
  poker: [
    ['smallBlind', 'Small blind', 1, 100000],
    ['bigBlind', 'Big blind', 2, 100000],
    ['buyIn', 'Số chip mua vào', 20, 10000000],
    ['maxSeats', 'Số ghế', 2, 9],
    ['turnSeconds', 'Thời gian mỗi lượt (giây)', 10, 120],
    ['rabbitHunt', 'Cho xem rabbit hunt (lật bài chung còn lại khi ván kết thúc sớm)', 'bool'],
  ],
  samloc: [
    ['maxSeats', 'Số người chơi tối đa', 2, 5],
    ['unit', 'Mức cược / đơn vị', 1, 1000000],
    ['turnSeconds', 'Thời gian mỗi lượt (giây)', 10, 120],
  ],
  tala: [
    ['maxSeats', 'Số người chơi tối đa', 2, 4],
    ['unit', 'Mức cược / đơn vị', 1, 1000000],
    ['turnSeconds', 'Thời gian mỗi lượt (giây)', 10, 120],
  ],
};

export default function CreateRoomDialog({ game: initialGame, onClose }) {
  const { call, user } = useApp();
  const [game, setGame] = useState(initialGame);
  const [name, setName] = useState('');
  const [opts, setOpts] = useState(DEFAULTS);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await call('room:create', { name, game, options: opts[game] });
    setBusy(false);
    if (res) onClose();
  };

  return (
    <Modal title="Tạo bàn mới" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Trò chơi</label>
        <div className="seg">
          {Object.entries(GAME_META).map(([k, g]) => (
            <button type="button" key={k} className={game === k ? 'active' : ''} onClick={() => setGame(k)}>
              <GameIcon game={k} size={16} /> {g.name}
            </button>
          ))}
        </div>
        <label>Tên phòng</label>
        <input autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)}
          placeholder={`Bàn ${GAME_META[game].name} của ${user.name}`} />
        {FIELDS[game].map(([key, label, min, max]) => min === 'bool' ? (
          <label key={key} className="check">
            <input type="checkbox" checked={!!opts[game][key]}
              onChange={(e) => setOpts({ ...opts, [game]: { ...opts[game], [key]: e.target.checked } })} />
            {label}
          </label>
        ) : (
          <div key={key}>
            <label>{label}</label>
            <input type="number" min={min} max={max} value={opts[game][key]}
              onChange={(e) => setOpts({ ...opts, [game]: { ...opts[game], [key]: e.target.value } })} />
          </div>
        ))}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>Tạo và vào bàn</button>
        </div>
      </form>
    </Modal>
  );
}
