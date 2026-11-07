import { useEffect, useState } from 'react';

/** Kỷ lục trên thiết bị chỉ lấy từ điểm server đã xác nhận. */
export function usePersonalBest(game: string, score: number) {
  const key = `game-best:${game}`;
  const [best, setBest] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return Number.isFinite(saved) && saved > 0 ? saved : 0;
    } catch { return 0; }
  });
  useEffect(() => {
    setBest((previous) => {
      let saved = 0;
      try { saved = Number(localStorage.getItem(key)) || 0; } catch { /* Storage có thể bị chặn. */ }
      const next = Math.max(previous, score, Number.isFinite(saved) ? saved : 0);
      try { localStorage.setItem(key, String(next)); } catch { /* Vẫn giữ kỷ lục trong phiên. */ }
      return next;
    });
  }, [key, score]);
  return best;
}
