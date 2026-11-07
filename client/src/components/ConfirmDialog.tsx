import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  title?: ReactNode;
  children: ReactNode;
  okLabel?: string;
  danger?: boolean;
  icon?: ReactNode;
  onOk: () => unknown;
  onClose: () => void;
}

import Modal from './Modal.js';
import './ConfirmDialog.css';

/** Hộp xác nhận trong app (thay cho confirm() của trình duyệt): rõ ràng, có nút to, đóng bằng Esc. */
export default function ConfirmDialog({ title, children, okLabel = 'Đồng ý', danger, icon, onOk, onClose }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="confirm-body">
        {icon && <span className={`confirm-icon ${danger ? 'danger' : ''}`} aria-hidden>{icon}</span>}
        <div>{children}</div>
      </div>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>Hủy</button>
        <button className={`btn ${danger ? 'danger' : 'cta'}`} autoFocus onClick={() => { onOk(); onClose(); }}>{okLabel}</button>
      </div>
    </Modal>
  );
}
