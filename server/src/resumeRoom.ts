// Timers are reconstructed from absolute deadlines, so downtime consumes game time.
// Never call a constructor/start method here: that would redeal cards or expose a new answer.
import type { Room } from './lobby.js';
import { CaroHandler } from './games/caro.js';
import { ChessHandler } from './games/chess.js';
import { OnetHandler } from './games/onet.js';
import { PokerHandler } from './games/poker.js';
import { QuizHandler } from './games/quiz.js';
import { SamLocHandler } from './games/samloc.js';
import { ScribbleHandler } from './games/scribble.js';
import { SnakeHandler } from './games/snake.js';
import { TetrisHandler } from './games/tetris.js';
import { RaceHandler } from './games/race.js';
import { TalaHandler } from './games/tala.js';
import { TelephoneHandler } from './games/telephone.js';
import { WordChainHandler } from './games/wordchain.js';
import { WordGuessHandler } from './games/wordguess.js';
import { XiangqiHandler } from './games/xiangqi.js';

export function resumeRoom(room: Room) {
  const h = room.handler;
  const arm = (deadline: number, fn: () => void) => setTimeout(() => {
    try { fn(); room.changed(); }
    catch (error) { console.error('[recovery timer]', room.game, error); }
  }, Math.max(0, deadline - Date.now()));
  // Snapshot restores real handler prototypes, so instanceof selects the same branch as the game id.
  if (h instanceof ChessHandler) {
    h._schedule();
  } else if (h instanceof XiangqiHandler || h instanceof CaroHandler) {
    h._schedule();
    h._botTick();
  } else if (h instanceof TalaHandler || h instanceof SamLocHandler) {
    if (h.game && !h.game.result) h.timer = arm(h.deadline, () => {
      const game = h.game!;
      game.autoPlay(game.players[game.turn].id);
      h._afterAction();
    });
  } else if (h instanceof PokerHandler) {
    if (h.game.inHand) h._resetTurnTimer();
    else if (h.started && h.nextHandAt) h.nextHandTimer = arm(h.nextHandAt, () => {
      h.nextHandTimer = null;
      h.nextHandAt = 0;
      if (h.started && h.game.canStart()) { h.game.startHand(); h._afterChange(); }
    });
  } else if (h instanceof WordChainHandler) {
    if (h.status === 'playing') { h.timer = arm(h.deadline, () => h._onTimeout()); h._botTick(); }
  } else if (h instanceof QuizHandler) {
    const g = h.game;
    if (h.status === 'playing' && g) h.timer = arm(g.deadline + (g.phase === 'question' ? 300 : 0), () => {
      const phase = h.game!.phase;
      if (phase === 'intro') h._ask(0);
      else if (phase === 'question') h._reveal();
      else if (phase === 'reveal') h._advance();
    });
  } else if (h instanceof WordGuessHandler) {
    if (h.status === 'playing' && h.game) h.timer = arm(h.game.deadline, () => h._finish('timeout'));
  } else if (h instanceof TelephoneHandler) {
    if (h.status === 'playing') h.timer = arm(h.deadline + 1500, () => h._endStep());
  } else if (h instanceof ScribbleHandler) {
    if (h.status === 'playing') {
      h.timer = arm(h.deadline, () => {
        if (h.phase === 'choose') h._beginDraw(h.choices[0]);
        else if (h.phase === 'draw') h._endTurn();
        else if (h.phase === 'reveal') h._nextTurn();
      });
      if (h.phase === 'draw') h._scheduleHints();
    }
  } else if (h instanceof TetrisHandler && h.isPlaying()) {
    h.schedule();
  } else if (h instanceof RaceHandler && h.isPlaying()) {
    h.arm(); // Bay qua khe, Đào vàng: hẹn lại từ startAt tuyệt đối, không đổi hạt giống
  } else if (h instanceof SnakeHandler && h.status === 'playing') {
    if (h.deadline) h.timer = arm(h.deadline, () => {
      for (const p of h.players) if (!p.done) h._out(p, 'timedOut');
      h._finish();
    });
    h._arm();
  } else if (h instanceof OnetHandler && h.status === 'playing') {
    if (!h.classic) h.timer = arm(h.deadline, () => h._finish());
    else for (const player of h.players) {
      if (player.done) continue;
      player.timer = setTimeout(() => {
        if (h.status !== 'playing' || player.done) return;
        player.done = true;
        player.timedOut = true;
        h._checkEnd();
        room.changed();
      }, Math.max(0, player.deadline - Date.now()));
    }
  }
}
