import { useMemo } from 'react';
import { describeHand, HAND_NAMES_VI } from '@game/shared/poker';
import Card from '../components/Card.js';
import type { PokerView } from '@game/shared/views';
import './PokerPanels.css';

// Ví dụ cho từng bộ, từ yếu tới mạnh (cùng thứ tự HAND_NAMES_VI)
const EXAMPLES = [
  ['AS', 'JD', '8C', '5H', '3S'],
  ['QS', 'QH', '9C', '6D', '2S'],
  ['KS', 'KD', '7C', '7H', '4S'],
  ['8S', '8D', '8H', 'KC', '3S'],
  ['9C', '8D', '7S', '6H', '5C'],
  ['AH', 'JH', '9H', '6H', '2H'],
  ['TS', 'TD', 'TC', '4H', '4S'],
  ['JS', 'JD', 'JC', 'JH', '7S'],
  ['9S', '8S', '7S', '6S', '5S'],
];

/** Bảng luật Texas Hold'em tóm tắt + thứ hạng các bộ bài. `current` = bộ hiện tại của người xem (để làm nổi bật). */
export function PokerRules({ s, current = -1, bare = false }: { s: Pick<PokerView, 'smallBlind' | 'bigBlind'>; current?: number; bare?: boolean }) {
  return (
    <div className={`pk-rules ${bare ? 'bare' : 'panel'}`}>
      {!bare && <h4>Luật Texas Hold'em</h4>}
      <ul>
        <li>Mỗi người nhận <b>2 lá tẩy</b> úp. Có tối đa <b>5 lá bài chung</b> ngửa giữa bàn: Flop (3 lá) → Turn (1) → River (1).</li>
        <li>Mỗi ván có 4 vòng cược: Preflop, Flop, Turn, River. Nút <b>D</b> (dealer) xoay vòng; hai người bên trái đặt <b>small blind</b> ({s.smallBlind}) và <b>big blind</b> ({s.bigBlind}) bắt buộc.</li>
        <li>Tới lượt: <b>Bỏ bài</b>, <b>Check</b> (khi không phải theo), <b>Theo</b>, <b>Cược/Tố</b> (No-Limit: tối thiểu bằng big blind hoặc mức tố trước đó), <b>All-in</b>.</li>
        <li>Hết giờ: tự check nếu được, không thì tự bỏ bài.</li>
        <li><b>Showdown:</b> ai còn lại sau River lật bài; mỗi người lấy <b>5 lá mạnh nhất</b> từ 7 lá (2 tẩy + 5 chung), có thể dùng 0, 1 hoặc 2 lá tẩy. Bộ mạnh hơn thắng; bằng nhau xét lá phụ (kicker), vẫn bằng thì chia đều pot.</li>
        <li>All-in không đủ tiền theo sẽ tạo <b>pot phụ</b> — chỉ thắng được phần mình đã góp.</li>
        <li><b>Show bài:</b> ván kết thúc mà bài bạn chưa lật (đã bỏ bài, hoặc thắng vì mọi người bỏ) thì có thể bấm <b>Show bài</b> (<kbd>S</kbd>) cho cả bàn xem. <b>Rabbit</b> (<kbd>T</kbd>): xem các lá chung lẽ ra sẽ ra.</li>
        <li>Phím tắt: <kbd>F</kbd> bỏ, <kbd>C</kbd> theo/check, <kbd>B</kbd>/<kbd>R</kbd> cược/tố, <kbd>A</kbd> all-in, <kbd>1</kbd>–<kbd>4</kbd> mức ⅓ ½ ¾ pot, <kbd>↑</kbd>/<kbd>↓</kbd> chỉnh mức cược.</li>
      </ul>
      <h4>Thứ hạng bộ bài (mạnh → yếu)</h4>
      <ol className="pk-ranks">
        {HAND_NAMES_VI.map((name, i) => ({ name, i })).reverse().map(({ name, i }) => (
          <li key={i} className={i === current ? 'cur' : ''}>
            <span className="pk-rank-name">{name}{i === current && <span className="pk-rank-you"> ← bài bạn</span>}</span>
            <span className="pk-rank-cards">{EXAMPLES[i].map((c) => <Card key={c} card={c} size="sm" />)}</span>
          </li>
        ))}
      </ol>
      <div className="muted small">A vừa là lá cao nhất vừa là lá thấp nhất trong sảnh A-2-3-4-5. Không xét chất khi so bài.</div>
    </div>
  );
}

/** Lá tẩy thật của người xem (không phải lá úp / đã bỏ). */
export function myHole(s: PokerView) {
  const seat = s.mySeat >= 0 ? s.seats[s.mySeat] : null;
  const hole = seat?.hole;
  return hole && hole.length === 2 && !hole.includes('??') ? hole : null;
}

/** Bảng "Bài mạnh nhất": combo 5 lá tốt nhất từ 2 lá tẩy + bài chung hiện có. */
export function BestHandPanel({ s }: { s: PokerView }) {
  const hole = myHole(s);
  const board = s.hand?.board || [];
  const info = useMemo(() => (hole ? describeHand(hole, board) : null), [hole?.join(), board.join()]);
  if (!info || !hole) return null;
  const used = new Set(info.used);
  const folded = s.seats[s.mySeat]?.folded;
  return (
    <div className={`panel pk-best ${folded ? 'folded' : ''}`}>
      <div className="pk-best-head">
        <h4>Bài mạnh nhất của bạn</h4>
        {folded && <span className="muted small">(đã bỏ bài)</span>}
      </div>
      <div className="pk-best-name">{info.name}</div>
      <div className="pk-best-cards">
        {info.cards.map((c) => (
          <div key={c} className="pk-best-card">
            <Card card={c} size="md" highlight={used.has(c)} dim={!used.has(c)} />
            <span className="pk-best-src">{hole.includes(c) ? 'tẩy' : 'chung'}</span>
          </div>
        ))}
        {Array.from({ length: Math.max(0, 5 - info.cards.length) }, (_, k) => <div key={`e${k}`} className="card-slot pk-best-slot" />)}
      </div>
      <div className="muted small">
        {board.length < 3 ? 'Chưa ra Flop — mới tính 2 lá tẩy.' : `Chọn từ ${hole.length + board.length} lá (2 tẩy + ${board.length} chung). Lá sáng là lá tạo bộ, lá mờ là kicker.`}
        {info.draws.length > 0 && <> · <span className="pk-best-draw">{info.draws.join(', ')}</span></>}
      </div>
    </div>
  );
}
