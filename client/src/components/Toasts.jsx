import { useApp } from '../store.jsx';

export default function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts">
      {/* Chỉ hiện thông báo mới nhất: thông báo cũ tắt đi không làm xô các thông báo khác */}
      {toasts.slice(-1).map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>{t.text}</div>
      ))}
    </div>
  );
}
