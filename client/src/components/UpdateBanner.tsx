import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../store.js';
import './UpdateBanner.css';

/** Thông báo khi server đã chạy bản deploy mới hơn bản đang mở trong trình duyệt. */
export default function UpdateBanner() {
  const { newVersion, room } = useApp();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!newVersion || dismissed === newVersion) return null;
  return (
    <div className="update-banner" role="status">
      <span>🎉 Đã có phiên bản mới của Sảnh Trò Chơi.</span>
      {room && <span className="muted small">Tải lại vẫn giữ chỗ của bạn trong phòng.</span>}
      <div className="row">
        <button className="btn primary sm" onClick={() => location.reload()}><RefreshCw size={14} aria-hidden /> Tải lại</button>
        <button className="btn ghost sm" onClick={() => setDismissed(newVersion)}>Để sau</button>
      </div>
    </div>
  );
}
