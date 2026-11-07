import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import Modal from './Modal.js';
import type { FairnessView } from '@game/shared/views';
import './FairnessBadge.css';

type Revealed = Extract<NonNullable<FairnessView>, { leaves: string[] }>;
interface VerifyResult { ok: boolean | null; reason: string }

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/**
 * Kiểm chứng một ván đã công bố so với commit nhận được lúc đầu ván.
 * Trả về { ok, reason }.
 */
async function verify(seenCommit: string | undefined, f: Revealed): Promise<VerifyResult> {
  if (!globalThis.crypto?.subtle) return { ok: null, reason: 'Trình duyệt chỉ kiểm chứng được qua HTTPS' };
  if (!seenCommit) return { ok: null, reason: 'Bạn vào giữa ván nên chưa nhận được mã cam kết lúc đầu ván' };
  if (seenCommit !== f.commit) return { ok: false, reason: 'Mã cam kết khi kết thúc khác lúc đầu ván' };
  if (!Array.isArray(f.leaves) || f.leaves.length !== f.total) return { ok: false, reason: 'Dữ liệu công bố không đầy đủ' };
  if ((await sha256(f.leaves.join(''))) !== seenCommit) return { ok: false, reason: 'Các mã từng lá không khớp mã cam kết' };
  const seen = new Set<string>();
  for (const { i, card, salt } of f.cards) {
    if (seen.has(card)) return { ok: false, reason: `Lá ${card} xuất hiện hai lần` };
    seen.add(card);
    if ((await sha256(`${i}:${card}:${salt}`)) !== f.leaves[i]) return { ok: false, reason: `Lá ở vị trí ${i + 1} không khớp` };
  }
  if (!f.cards.length) return { ok: true, reason: 'Ván kết thúc trước khi bạn thấy lá nào; dữ liệu công bố khớp mã cam kết' };
  return { ok: true, reason: `Đã kiểm ${f.cards.length}/${f.total} lá bạn được thấy: đúng là các lá đã niêm phong từ lúc xáo` };
}

// Nhớ commit đã thấy lúc đầu mỗi ván (theo phòng + số ván) và kết quả kiểm chứng, sống qua các lần render
const seenCommits = new Map<string, string>();
const results = new Map<string, VerifyResult>();

/** Huy hiệu "xáo bài kiểm chứng được" cho các game bài (Poker, Tá lả, Sâm lốc). */
export default function FairnessBadge({ roomId, fair }: { roomId: string; fair: FairnessView }) {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);
  const key = fair ? `${roomId}:${fair.no}` : null;
  const shown = fair && 'leaves' in fair ? fair : null;
  const revealed = !!shown;

  if (fair && key && !revealed && !seenCommits.has(key)) seenCommits.set(key, fair.commit);

  useEffect(() => {
    if (!key || !shown || results.has(key)) return;
    results.set(key, { ok: null, reason: 'Đang kiểm chứng…' });
    verify(seenCommits.get(key), shown)
      .catch((): VerifyResult => ({ ok: false, reason: 'Lỗi khi kiểm chứng' }))
      .then((r) => { results.set(key, r); force((n) => n + 1); });
  }, [key, shown]);

  if (!fair) return null;
  const res = revealed && key ? results.get(key) : null;
  const Icon = res?.ok === true ? ShieldCheck : res?.ok === false ? ShieldAlert : Shield;
  const cls = res?.ok === true ? 'pos' : res?.ok === false ? 'neg' : 'muted';
  const label = !revealed ? 'Bộ bài đã được niêm phong' : res?.ok === true ? 'Bộ bài hợp lệ' : res?.ok === false ? 'Bộ bài KHÔNG khớp' : 'Chưa kiểm chứng được';

  return (
    <>
      <button className={`fair-badge ${cls}`} onClick={() => setOpen(true)} title={`Ván #${fair.no}: ${label} — bấm để xem cách kiểm chứng`}>
        <Icon size={16} aria-hidden /><span className="fb-text">Ván #{fair.no}: {label}</span>
      </button>
      {open && (
        <Modal title="Xáo bài kiểm chứng được" onClose={() => setOpen(false)}>
          <div className="fair-info">
            <p>
              Server xáo bài bằng thuật toán Fisher–Yates với bộ sinh số ngẫu nhiên an toàn mật mã của hệ điều hành.
              Ngay khi xáo, server gửi cho mọi người một <b>mã cam kết</b> (SHA-256) của thứ tự bộ bài — trước khi ai thấy lá nào.
              Hết ván, server công bố bộ bài để trình duyệt của bạn tự kiểm tra rằng bài không bị đổi giữa chừng.
              Bài đã bỏ của người khác (Poker) vẫn được giữ kín.
            </p>
            <p><span className="muted">Mã cam kết lúc đầu ván:</span><br /><code>{(key && seenCommits.get(key)) || '—'}</code></p>
            {revealed ? (
              <p className={cls}><Icon size={14} aria-hidden /> {res?.reason}</p>
            ) : (
              <p className="muted">Kết quả kiểm chứng sẽ có khi ván kết thúc.</p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
