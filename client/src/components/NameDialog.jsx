import { useState } from 'react';
import { useApp } from '../store.jsx';
import { storage } from '../socket.js';
import Modal from './Modal.jsx';

/** Đổi tên khi đã vào sảnh (lần đầu nhập tên nằm trong Onboarding). */
export default function NameDialog({ onClose }) {
  const { call, setUser, user } = useApp();
  const [name, setName] = useState(user?.name || storage.name);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const nm = name.trim();
    if (!nm || busy) return;
    setBusy(true);
    const res = await call('user:rename', { name: nm });
    setBusy(false);
    if (res) { storage.name = res.user.name; setUser(res.user); onClose(); }
  };

  return (
    <Modal title="Đổi tên" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <input autoFocus maxLength={24} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên hiển thị" />
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Hủy</button>
          <button className="btn primary" disabled={busy || !name.trim()}>{busy ? <span className="spinner" /> : null} Lưu</button>
        </div>
      </form>
    </Modal>
  );
}
