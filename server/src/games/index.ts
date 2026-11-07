import { ChessHandler } from './chess.js';
import { XiangqiHandler } from './xiangqi.js';
import { PokerHandler } from './poker.js';
import { TalaHandler } from './tala.js';
import { CaroHandler } from './caro.js';
import { SamLocHandler } from './samloc.js';
import { WordChainHandler } from './wordchain.js';
import { QuizHandler } from './quiz.js';
import { WordGuessHandler } from './wordguess.js';
import { ScribbleHandler } from './scribble.js';
import { TelephoneHandler } from './telephone.js';
import { OnetHandler } from './onet.js';
import { SnakeHandler } from './snake.js';
import { TetrisHandler } from './tetris.js';
import { SkyhopHandler } from './skyhop.js';
import { GoldmineHandler } from './goldmine.js';

/**
 * Các trò chơi. Mỗi Handler điều khiển một bàn trong một phòng và cần có:
 *   options, maxPlayers, playerIds(), isPlaying(), sit(user, seat?), stand(id), onLeave(id),
 *   rename(id, name), action(id, payload), view(viewerId), dispose()
 * và tùy chọn query(viewerId, q) cho dữ liệu lớn lấy theo yêu cầu, stream(id, payload) cho dữ liệu
 * gửi liên tục (nét vẽ) chuyển thẳng cho người khác, censorChat(id, text) để chặn tin nhắn lộ đáp án.
 */
export const GAMES = {
  chess: { name: 'Cờ vua', Handler: ChessHandler },
  xiangqi: { name: 'Cờ tướng', Handler: XiangqiHandler },
  poker: { name: 'Poker', Handler: PokerHandler },
  tala: { name: 'Tá lả', Handler: TalaHandler },
  caro: { name: 'Cờ caro', Handler: CaroHandler },
  samloc: { name: 'Sâm lốc', Handler: SamLocHandler },
  wordchain: { name: 'Nối từ', Handler: WordChainHandler },
  quiz: { name: 'Đố vui', Handler: QuizHandler },
  wordguess: { name: 'Đoán chữ', Handler: WordGuessHandler },
  scribble: { name: 'Vẽ đoán', Handler: ScribbleHandler },
  telephone: { name: 'Tam sao thất bản', Handler: TelephoneHandler },
  onet: { name: 'Nối thú', Handler: OnetHandler },
  snake: { name: 'Rắn săn mồi', Handler: SnakeHandler },
  tetris: { name: 'Tetris', Handler: TetrisHandler },
  skyhop: { name: 'Bay qua khe', Handler: SkyhopHandler },
  goldmine: { name: 'Đào vàng', Handler: GoldmineHandler },
};

export type GameId = keyof typeof GAMES;
export const isGame = (game: unknown): game is GameId => typeof game === 'string' && Object.hasOwn(GAMES, game);
