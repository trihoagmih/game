import { useEffect, useState } from 'react';
import { useApp } from './store.jsx';
import Lobby from './components/Lobby.jsx';
import RoomView from './components/RoomView.jsx';
import NameDialog from './components/NameDialog.jsx';
import Toasts from './components/Toasts.jsx';
import Onboarding from './components/Onboarding.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';

export default function App() {
  const { connected, user, room, phase, server, switchServer } = useApp();
  const [renaming, setRenaming] = useState(false);
  const ready = phase === 'ready' && user;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); if (room) location.hash = ''; }}>
          <span className="brand-logo" aria-hidden>🎲</span>
          <span className="brand-name">Sảnh Trò Chơi</span>
        </a>
        {ready && server?.name && <span className="server-badge" title="Server đang vào">{server.name}</span>}
        <div className="topbar-right">
          {ready && (
            <>
              <span className={`conn ${connected ? 'on' : 'off'}`} title={connected ? 'Đã kết nối' : 'Mất kết nối'} />
              {server?.gated && (
                <button className="btn ghost sm" title="Vào server khác bằng mật khẩu khác"
                  onClick={() => (!room || confirm('Rời phòng và đổi sang server khác?')) && switchServer()}>
                  ⇄ <span className="hide-sm">Đổi server</span>
                </button>
              )}
              <button className="user-chip" onClick={() => setRenaming(true)} title="Đổi tên">
                <span className="avatar" aria-hidden>{user.name.trim()[0]?.toUpperCase()}</span>
                <span className="user-name">{user.name}</span>
              </button>
            </>
          )}
        </div>
        <BusyBar />
      </header>
      <main className="main">
        {!ready ? <Onboarding /> : room ? <RoomView /> : <Lobby />}
      </main>
      {renaming && ready && <NameDialog onClose={() => setRenaming(false)} />}
      <Toasts />
      <UpdateBanner />
      {ready && !connected && <div className="reconnect" role="status"><span className="spinner" /> Mất kết nối, đang thử lại…</div>}
    </div>
  );
}

/** Thanh tiến trình mảnh dưới header khi có yêu cầu chờ server lâu hơn 250ms. */
function BusyBar() {
  const { busy } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!busy) return setShow(false);
    const t = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(t);
  }, [busy]);
  return <div className={`busy-bar ${show ? 'on' : ''}`} aria-hidden />;
}
