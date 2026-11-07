import { useToasts } from '../store.js';
import './Toasts.css';

export default function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {/* Chỉ hiện thông báo mới nhất: thông báo cũ tắt đi không làm xô các thông báo khác */}
      {toasts.slice(-1).map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>
      ))}
    </div>
  );
}
