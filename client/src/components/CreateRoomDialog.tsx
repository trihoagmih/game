import { useState } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../store.js';
import Modal from './Modal.js';
import { GAME_META, GameIcon } from './Lobby.js';
import { QUIZ_CATEGORIES } from '@game/shared/quiz';
import { LINE_TARGET } from '@game/shared/tetris';
import { DIFFICULTY, TARGET } from '@game/shared/skyhop';
import { LEVEL_COUNT } from '@game/shared/goldmine';
import { DIFFICULTIES, MAX_SEATS, READ_SECONDS, ROUNDS } from '@game/shared/twister';

type OptionValue = string | number | boolean;
type GameOptions = Record<string, OptionValue>;

const DEFAULTS: Record<string, GameOptions> = {
  tetris: { targetLines: LINE_TARGET.default },
  chess: { minutes: 10 },
  xiangqi: { minutes: 8 },
  caro: { size: 15, minutes: 10, blockTwoEnds: true, bot: '' },
  wordchain: { maxSeats: 6, turnSeconds: 20, lives: 1, dictionary: true, strict: true, bot: '', bots: 1 },
  poker: { smallBlind: 10, bigBlind: 20, buyIn: 2000, maxSeats: 6, turnSeconds: 30, rabbitHunt: true },
  tala: { maxSeats: 4, unit: 10, turnSeconds: 30 },
  quiz: { category: 'all', questions: 10, seconds: 20, maxSeats: 20 },
  wordguess: { mode: 'race', minutes: 5, maxSeats: 6, daily: false, strict: true },
  samloc: { maxSeats: 4, unit: 10, turnSeconds: 25 },
  scribble: { maxSeats: 8, rounds: 3, drawSeconds: 80, hints: true, customWords: '', onlyCustom: false },
  twister: { difficulty: 'mix', maxSeats: MAX_SEATS.default, rounds: ROUNDS.default, readSeconds: READ_SECONDS.default },
  telephone: { mode: 'classic', maxSeats: 8, writeSeconds: 40, drawSeconds: 90, suggest: true },
  snake: { maxSeats: 4, level: 5, maze: 'none', minutes: 0 },
  chicken: { maxSeats: 4, level: 1 },
  skyhop: { maxSeats: 4, level: 2, target: TARGET.default },
  goldmine: { maxSeats: 4, levels: LEVEL_COUNT.default },
  onet: { mode: 'race', maxSeats: 4, rows: 9, cols: 16, minutes: 8, hints: 3, shuffles: 3, gravity: false },
};

// Tạo bàn kèm máy (Cờ caro / Nối từ)
const BOT_OPTIONS: [string, string][] = [['', 'Không — chơi với người'], ['easy', 'Máy Dễ'], ['medium', 'Máy Vừa'], ['hard', 'Máy Khó']];

// [khóa, nhãn, min, max] · [khóa, nhãn, 'bool'] · [khóa, nhãn, 'text'] · [khóa, nhãn, 'select', các lựa chọn]
type Field =
  | [key: string, label: string, min: number, max: number]
  | [key: string, label: string, kind: 'bool' | 'text']
  | [key: string, label: string, kind: 'select', choices: [string, string][]];
const FIELDS: Record<string, Field[]> = {
  tetris: [['targetLines', 'Số hàng cần xóa để thắng', LINE_TARGET.min, LINE_TARGET.max]],
  chess: [['minutes', 'Thời gian mỗi bên (phút)', 1, 60]],

  quiz: [
    ['category', 'Chủ đề (bộ câu hỏi có sẵn)', 'select', [['all', 'Tất cả chủ đề'], ...QUIZ_CATEGORIES.map((c): [string, string] => [c, c])]],
    ['questions', 'Số câu mỗi ván', 3, 30],
    ['seconds', 'Thời gian mỗi câu (giây)', 5, 60],
    ['maxSeats', 'Số người chơi tối đa', 1, 30],
  ],
  wordguess: [
    ['mode', 'Chế độ', 'select', [['race', 'Đua — mỗi người một bàn, cùng một từ'], ['coop', 'Cùng đoán — cả phòng chung một bàn']]],
    ['daily', 'Từ của ngày (mọi người cùng một từ, mỗi ngày đổi)', 'bool'],
    ['minutes', 'Thời gian mỗi ván (phút)', 1, 15],
    ['maxSeats', 'Số người chơi tối đa', 1, 10],
  ],
  xiangqi: [['minutes', 'Thời gian mỗi bên (phút)', 1, 60]],
  wordchain: [
    ['maxSeats', 'Số người chơi tối đa', 2, 8],
    ['turnSeconds', 'Thời gian mỗi lượt (giây)', 10, 60],
    ['lives', 'Số mạng mỗi người', 1, 3],
    ['dictionary', 'Kiểm tra từ điển (mỗi chữ phải là tiếng Việt)', 'bool'],
    ['strict', 'Chặt: cả từ phải có trong từ điển (~62.000 từ). Tắt = thoáng, từ lạ chỉ bị gắn cờ', 'bool'],
    ['bot', 'Chơi với máy', 'select', BOT_OPTIONS],
    ['bots', 'Số máy', 1, 3],
  ],
  caro: [
    ['size', 'Kích thước bàn (ô mỗi cạnh)', 10, 20],
    ['minutes', 'Thời gian mỗi bên (phút)', 1, 60],
    ['blockTwoEnds', 'Chặn hai đầu thì không tính thắng', 'bool'],
    ['bot', 'Chơi với máy (bạn cầm X, đi trước)', 'select', BOT_OPTIONS],
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
  scribble: [
    ['maxSeats', 'Số người chơi tối đa', 2, 12],
    ['rounds', 'Số vòng (mỗi vòng ai cũng vẽ một lần)', 1, 6],
    ['drawSeconds', 'Thời gian vẽ mỗi lượt (giây)', 30, 180],
    ['hints', 'Gợi ý dần vài chữ cái khi hết gần nửa thời gian', 'bool'],
    ['customWords', 'Từ tự thêm (cách nhau dấu phẩy, không bắt buộc)', 'text'],
    ['onlyCustom', 'Chỉ dùng từ tự thêm (cần ít nhất 10 từ)', 'bool'],
  ],
  telephone: [
    ['mode', 'Chế độ', 'select', [['classic', 'Cổ điển — viết và vẽ xen kẽ, cùng lúc'], ['relay', 'Chuyền hình — lần lượt vẽ, người cuối đoán']]],
    ['maxSeats', 'Số người chơi tối đa', 3, 12],
    ['writeSeconds', 'Thời gian viết / đoán mỗi bước (giây)', 15, 120],
    ['drawSeconds', 'Thời gian vẽ mỗi bước (giây)', 30, 240],
    ['suggest', 'Cho lấy gợi ý ở bước viết câu đầu tiên', 'bool'],
  ],
  twister: [
    ['difficulty', 'Độ khó của câu', 'select', DIFFICULTIES],
    ['rounds', 'Số câu mỗi người đọc', ROUNDS.min, ROUNDS.max],
    ['readSeconds', 'Thời gian đọc mỗi câu (giây)', READ_SECONDS.min, READ_SECONDS.max],
    ['maxSeats', 'Số người chơi tối đa (chia 2 đội)', MAX_SEATS.min, MAX_SEATS.max],
  ],
  onet: [
    ['mode', 'Chế độ', 'select', [['race', 'Đua dọn bàn (1 bàn, ai sạch trước thắng)'], ['classic', 'Cổ điển (9 màn, hình dồn theo hướng)']]],
    ['maxSeats', 'Số người chơi tối đa (1 = chơi một mình)', 1, 8],
    ['rows', 'Số hàng', 4, 10],
    ['cols', 'Số cột (tổng số ô phải chẵn)', 4, 18],
    ['minutes', 'Thời gian mỗi ván / mỗi màn ở chế độ cổ điển (phút)', 1, 30],
    ['hints', 'Số lượt gợi ý', 0, 20],
    ['shuffles', 'Số lượt đổi hình (xáo bàn)', 0, 20],
    ['gravity', 'Trọng lực: nối xong các hình rơi xuống lấp chỗ trống (khó hơn)', 'bool'],
  ],
  snake: [
    ['level', 'Cấp tốc độ (1 chậm – 9 nhanh, điểm mỗi mồi = cấp)', 1, 9],
    ['maze', 'Mê cung', 'select', [['none', 'Không tường — đi xuyên mép'], ['box', 'Hộp kín — đụng viền là thua'], ['tunnel', 'Đường hầm — hai thanh ngang'], ['rooms', 'Bốn phòng — chữ thập có cửa'], ['rails', 'Đường ray — viền có cửa + hai thanh dọc']]],
    ['maxSeats', 'Số người chơi tối đa (1 = chơi một mình)', 1, 8],
    ['minutes', 'Giới hạn thời gian (phút, 0 = chơi tới khi đâm)', 0, 30],
  ],
  chicken: [
    ['level', 'Độ khó', 'select', [['1', 'Dễ'], ['2', 'Vừa'], ['3', 'Khó']]],
    ['maxSeats', 'Số người chơi tối đa (1 = chơi một mình)', 1, 8],
  ],
  skyhop: [
    ['level', 'Độ khó', 'select', DIFFICULTY.map((d, i): [string, string] => [String(i + 1), d.name])],
    ['maxSeats', 'Số người chơi tối đa (1 = chơi một mình)', 1, 8],
  ],
  goldmine: [
    ['levels', 'Số màn (mỗi màn 60 giây, mục tiêu tiền tăng dần)', LEVEL_COUNT.min, LEVEL_COUNT.max],
    ['maxSeats', 'Số người chơi tối đa (1 = chơi một mình)', 1, 8],
  ],
  tala: [
    ['maxSeats', 'Số người chơi tối đa', 2, 4],
    ['unit', 'Mức cược / đơn vị', 1, 1000000],
    ['turnSeconds', 'Thời gian mỗi lượt (giây)', 10, 120],
  ],
};

/** Một ô tùy chọn của bàn mới, theo loại trường. */
function OptionField({ field, value, onChange }: { field: Field; value: OptionValue | undefined; onChange: (v: OptionValue) => void }) {
  const [key, label] = field;
  if (field[2] === 'select') {
    return (
      <div>
        <label htmlFor={`opt-${key}`}>{label}</label>
        <select id={`opt-${key}`} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field[3].map(([v, name]) => <option key={v} value={v}>{name}</option>)}
        </select>
      </div>
    );
  }
  if (field[2] === 'text') {
    return (
      <div>
        <label htmlFor={`opt-${key}`}>{label}</label>
        <textarea id={`opt-${key}`} rows={3} maxLength={4000} value={String(value ?? '')} placeholder="vd: bánh bao, cái nón lá, con trâu"
          onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  if (field[2] === 'bool') {
    return (
      <label className="check">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  return (
    <div>
      <label htmlFor={`opt-${key}`}>{label}</label>
      <input id={`opt-${key}`} type="number" required={key === 'targetLines'} min={field[2]} max={field[3]} value={typeof value === 'boolean' ? String(value) : value ?? ''}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function CreateRoomDialog({ game: initialGame, onClose }: { game: string; onClose: () => void }) {
  const { call, user } = useApp();
  const [game, setGame] = useState(initialGame);
  const [name, setName] = useState('');
  const [opts, setOpts] = useState(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const options = opts[game] ?? {};
  const setOption = (key: string, value: OptionValue) => setOpts({ ...opts, [game]: { ...options, [key]: value } });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await call('room:create', { name, game, options });
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
          placeholder={`Bàn ${GAME_META[game]?.name} của ${user?.name}`} />
        {(FIELDS[game] ?? []).filter(([key]) => (key !== 'bots' || options.bot) && !(key === 'gravity' && options.mode === 'classic')).map((field) => (
          <OptionField key={field[0]} field={field} value={options[field[0]]} onChange={(v) => setOption(field[0], v)} />
        ))}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy}>Tạo và vào bàn</button>
        </div>
      </form>
    </Modal>
  );
}
