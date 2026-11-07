import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Dices, Lock, UserRound, Eye, EyeOff } from 'lucide-react';
import { useApp } from '../store.js';
import { AUTH_ERRORS, storage } from '../socket.js';
import './Onboarding.css';

/**
 * Một thẻ duy nhất cho toàn bộ luồng vào app: kết nối → mật khẩu → tên.
 * Thẻ giữ nguyên vị trí và kích thước, chỉ đổi nội dung bên trong → không nhấp nháy, không nhảy layout.
 */
export default function Onboarding() {
  const { phase } = useApp();
  // Kết nối thường xong trong ~100ms: chỉ hiện "đang kết nối" nếu lâu hơn 400ms để khỏi chớp
  const loading = phase === 'connecting' || phase === 'entering';
  const [showLoader, setShowLoader] = useState(false);
  useEffect(() => {
    if (!loading) return setShowLoader(false);
    const t = setTimeout(() => setShowLoader(true), 400);
    return () => clearTimeout(t);
  }, [loading]);

  return (
    <div className="onboard">
      <div className={`onboard-card ${loading && !showLoader ? 'hidden' : ''}`} aria-busy={loading}>
        <div className="onboard-logo" aria-hidden>
          {phase === 'name' ? <UserRound size={28} /> : phase === 'auth' || phase === 'checking' ? <Lock size={26} /> : <Dices size={28} />}
        </div>
        {loading ? <Connecting /> : phase === 'name' ? <NameStep /> : <PasswordStep />}
      </div>
    </div>
  );
}

function Connecting() {
  return (
    <div className="onboard-body">
      <h2>Sảnh Trò Chơi</h2>
      <p className="muted"><span className="spinner" /> Đang kết nối tới máy chủ…</p>
      <p className="muted small">Server miễn phí có thể mất 30–60 giây để thức dậy.</p>
    </div>
  );
}

function PasswordStep() {
  const { authError, login, phase } = useApp();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const checking = phase === 'checking';
  const locked = authError === 'AUTH_LOCKED';
  const error = authError && authError !== 'AUTH_REQUIRED' ? (AUTH_ERRORS as Record<string, string>)[authError] : null;
  // Sai mật khẩu: giữ chữ đã gõ, chọn sẵn để gõ lại
  useEffect(() => { if (error && !checking) ref.current?.select(); }, [error, checking]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pw && !checking && !locked) login(pw);
  };
  return (
    <form className="onboard-body form" onSubmit={submit}>
      <h2>Nhập mật khẩu</h2>
      <p className="muted small">Mỗi server có sảnh và phòng chơi riêng — nhập mật khẩu của server bạn muốn vào.</p>
      <label className="sr-only" htmlFor="pw">Mật khẩu</label>
      <div className="pw-field">
        <input id="pw" ref={ref} type={show ? 'text' : 'password'} name="password" autoFocus autoComplete="current-password" value={pw}
          aria-invalid={!!error} aria-describedby="pw-msg" onChange={(e) => setPw(e.target.value)} placeholder="Mật khẩu" readOnly={checking} />
        <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={show}>
          {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </div>
      <div className="onboard-msg" id="pw-msg" role="alert">{error && <span className="error-text">{error}</span>}</div>
      <button className="btn cta lg block" disabled={!pw || locked || checking}>
        {checking ? <><span className="spinner" /> Đang kiểm tra…</> : 'Tiếp tục'}
      </button>
    </form>
  );
}

function NameStep() {
  const { hello, toast, connected } = useApp();
  const [name, setName] = useState(storage.name);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nm = name.trim();
    if (!nm || busy) return;
    setBusy(true);
    storage.name = nm;
    try {
      await hello(nm);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
      setBusy(false);
    }
  };
  return (
    <form className="onboard-body form" onSubmit={submit}>
      <h2>Bạn tên gì?</h2>
      <p className="muted small">Tên hiển thị với mọi người trong phòng. Đổi lại được bất cứ lúc nào.</p>
      <label className="sr-only" htmlFor="nick">Tên hiển thị</label>
      <input id="nick" autoFocus maxLength={24} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên hiển thị" readOnly={busy} />
      <div className="onboard-msg" />
      <button className="btn cta lg block" disabled={busy || !name.trim() || !connected}>
        {busy ? <><span className="spinner" /> Đang vào sảnh…</> : 'Vào sảnh'}
      </button>
    </form>
  );
}
