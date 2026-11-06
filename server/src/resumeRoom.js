// Timers are reconstructed from absolute deadlines, so downtime consumes game time.
// Never call a constructor/start method here: that would redeal cards or expose a new answer.
export function resumeRoom(room) {
  const h = room.handler;
  const arm = (deadline, fn, field = 'timer') => {
    h[field] = setTimeout(() => {
      try { fn(); room.changed(); }
      catch (error) { console.error('[recovery timer]', room.game, error); }
    }, Math.max(0, deadline - Date.now()));
  };
  if (['chess', 'xiangqi', 'caro'].includes(room.game)) {
    h._schedule();
    h._botTick?.();
  } else if (['tala', 'samloc'].includes(room.game)) {
    if (h.game && !h.game.result) arm(h.deadline, () => {
      h.game.autoPlay(h.game.players[h.game.turn].id);
      h._afterAction();
    });
  } else if (room.game === 'poker') {
    if (h.game.inHand) h._resetTurnTimer();
    else if (h.started && h.nextHandAt) arm(h.nextHandAt, () => {
      h.nextHandTimer = null;
      h.nextHandAt = 0;
      if (h.started && h.game.canStart()) { h.game.startHand(); h._afterChange(); }
    }, 'nextHandTimer');
  } else if (room.game === 'wordchain') {
    if (h.status === 'playing') { arm(h.deadline, () => h._onTimeout()); h._botTick(); }
  } else if (room.game === 'quiz') {
    if (h.status === 'playing') arm(h.game.deadline + (h.game.phase === 'question' ? 300 : 0), () => {
      if (h.game.phase === 'intro') h._ask(0);
      else if (h.game.phase === 'question') h._reveal();
      else if (h.game.phase === 'reveal') h._advance();
    });
  } else if (room.game === 'wordguess') {
    if (h.status === 'playing') arm(h.game.deadline, () => h._finish('timeout'));
  } else if (room.game === 'telephone') {
    if (h.status === 'playing') arm(h.deadline + 1500, () => h._endStep());
  } else if (room.game === 'scribble') {
    if (h.status === 'playing') {
      arm(h.deadline, () => {
        if (h.phase === 'choose') h._beginDraw(h.choices[0]);
        else if (h.phase === 'draw') h._endTurn();
        else if (h.phase === 'reveal') h._nextTurn();
      });
      if (h.phase === 'draw') h._scheduleHints();
    }
  } else if (room.game === 'onet' && h.status === 'playing') {
    if (!h.classic) arm(h.deadline, () => h._finish());
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
