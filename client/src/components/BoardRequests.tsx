import { useEffect, useRef, useState } from 'react';
import { Undo2, Handshake, Loader2, X, Check, Trophy, Eye, Flag } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog.js';
import StartBar from './StartBar.js';
import { useApp } from '../store.js';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { DuelState } from './DuelPanels.js';
import './BoardRequests.css';

const KIND: Record<'undo' | 'draw', { icon: LucideIcon; ask: string; noun: string; detail: string }> = {
  undo: { icon: Undo2, ask: 'xin đi lại', noun: 'xin đi lại', detail: 'Nếu đồng ý, bàn cờ lùi lại nước vừa đi để người đó đi lại.' },
  draw: { icon: Handshake, ask: 'xin cầu hòa', noun: 'cầu hòa', detail: 'Nếu đồng ý, ván kết thúc hòa — mỗi bên được ½ điểm.' },
};

/**
 * Yêu cầu cần đối thủ đồng ý (xin đi lại / cầu hòa) cho Cờ tướng & Caro:
 *  - Người nhận: hộp nổi giữa bàn cờ, nền mờ, hai nút to Đồng ý / Từ chối (rung nhẹ trên điện thoại).
 *  - Người gửi: dải "Đang chờ … đồng ý" trên đầu bàn cờ, có nút Hủy; khi bị từ chối / được đồng ý có thông báo.
 *  - Người xem: dải thông tin nhỏ.
 */
export function RequestOverlay({ s, my, opp }: { s: DuelState; my: string | null; opp: string }) {
  const { act, toast } = useApp();
  const p = s.pending;
  const cancelled = useRef(false);
  const prev = useRef<{ type: 'undo' | 'draw'; moves: number } | null>(null);
  const incoming = p && my && p.from === opp;

  useEffect(() => {
    if (incoming) { try { navigator.vibrate?.([80, 60, 80]); } catch { /* không hỗ trợ */ } }
  }, [incoming]);

  // Yêu cầu của mình vừa được trả lời → báo kết quả rõ ràng
  useEffect(() => {
    const was = prev.current;
    prev.current = p && my && p.from === my ? { type: p.type, moves: s.moves.length } : null;
    if (!was || (p && p.from === my)) return;
    if (cancelled.current) { cancelled.current = false; return; }
    const name = s.seats[opp]?.name || 'Đối thủ';
    const accepted = was.type === 'draw' ? s.status === 'over' : s.moves.length < was.moves;
    if (s.status === 'over' && was.type !== 'draw') return; // ván kết thúc vì lý do khác
    toast(accepted ? `${name} đã đồng ý ${KIND[was.type].noun}` : `${name} đã từ chối ${KIND[was.type].noun}`, accepted ? 'info' : 'error');
  }, [p, my, opp, s.moves.length, s.status, s.seats, toast]);

  if (!p) return null;
  const k = KIND[p.type];
  const Icon = k.icon;
  const fromName = s.seats[p.from]?.name || 'Đối thủ';

  if (incoming) {
    return (
      <div className="board-overlay req" role="alertdialog" aria-modal="false" aria-labelledby="req-title" aria-describedby="req-detail">
        <div className="bo-card">
          <span className="bo-icon" aria-hidden><Icon size={26} /></span>
          <div id="req-title" className="bo-title"><b>{fromName}</b> {k.ask}</div>
          <div className="bo-tag">Cần bạn đồng ý</div>
          <div id="req-detail" className="bo-detail">{k.detail}</div>
          <div className="bo-actions">
            <button className="btn" onClick={() => act({ type: 'respond', accept: false })}><X size={16} aria-hidden /> Từ chối</button>
            <button className="btn cta" autoFocus onClick={() => act({ type: 'respond', accept: true })}><Check size={16} aria-hidden /> Đồng ý</button>
          </div>
        </div>
      </div>
    );
  }
  if (my && p.from === my) {
    return (
      <div className="board-strip" role="status">
        <Loader2 size={16} className="spin" aria-hidden />
        <span>Đang chờ <b>{s.seats[opp]?.name || 'đối thủ'}</b> đồng ý {k.noun}…</span>
        <button className="btn sm ghost" onClick={() => { cancelled.current = true; act({ type: 'cancelRequest' }); }}>Hủy</button>
      </div>
    );
  }
  return (
    <div className="board-strip" role="status">
      <Icon size={16} aria-hidden /><span><b>{fromName}</b> đang {k.ask}…</span>
    </div>
  );
}

/** Kết quả ván hiện đè lên giữa bàn cờ; bấm "Xem bàn cờ" để thu gọn thành dải nhỏ. */
export function ResultOverlay({ over, resetKey, title, detail, children, peek = 'Xem bàn cờ' }: {
  over: boolean; resetKey: unknown; title: ReactNode; detail?: ReactNode; children?: ReactNode; peek?: string;
}) {
  const [min, setMin] = useState(false);
  useEffect(() => { setMin(false); }, [resetKey]);
  if (!over) return null;
  if (min) {
    return (
      <button className="board-strip result" onClick={() => setMin(false)}>
        <Trophy size={16} aria-hidden /><span>{title}</span>
      </button>
    );
  }
  return (
    <div className="board-overlay result" role="status">
      <div className="bo-card">
        <span className="bo-icon gold" aria-hidden><Trophy size={26} /></span>
        <div className="bo-title">{title}</div>
        {detail && <div className="bo-detail">{detail}</div>}
        {children}
        <button className="link bo-peek" onClick={() => setMin(true)}><Eye size={14} aria-hidden /> {peek}</button>
      </div>
    </div>
  );
}

/**
 * Hàng nút gọn ngay dưới bàn cờ (Cờ tướng / Caro): Sẵn sàng / Bắt đầu (chủ phòng) · Xin đi lại · Cầu hòa · Xin thua.
 * Xin thua hỏi lại bằng hộp xác nhận trong app. `extra`: nút riêng của từng trò (vd. lật bàn).
 */
export function BoardActions({ s, my, opp, sitLabel, rematchLabel, extra }: {
  s: DuelState; my: string | null; opp: string; sitLabel: string; rematchLabel: string; extra?: ReactNode;
}) {
  const { act, call } = useApp();
  const [resign, setResign] = useState(false);
  const pending = s.pending;
  let main: ReactNode;
  const players = Object.values(s.seats).filter((x) => x != null);
  const ready = Object.entries(s.ready).filter(([, v]) => v).map(([c]) => s.seats[c]?.id).filter((id) => id != null);
  const over = s.status === 'over';
  const stand = <button className="btn ghost" onClick={() => call('room:stand', {})}><span className="hide-sm">Đứng dậy xem</span><span className="show-sm">Đứng dậy</span></button>;
  if (s.status === 'playing') {
    main = my ? (
      <>
        <button className="btn" disabled={!!pending} onClick={() => act({ type: 'requestUndo' })} title="Xin đi lại (cần đối thủ đồng ý)"><Undo2 size={16} aria-hidden /> Xin đi lại</button>
        <button className="btn" disabled={!!pending} onClick={() => act({ type: 'offerDraw' })} title="Cầu hòa (cần đối thủ đồng ý)"><Handshake size={16} aria-hidden /> Cầu hòa</button>
        <button className="btn danger" onClick={() => setResign(true)}><Flag size={16} aria-hidden /> Xin thua</button>
      </>
    ) : <span className="muted small ba-note">Bạn đang xem</span>;
  } else {
    // Chưa chơi / vừa xong ván: sẵn sàng rồi chủ phòng bấm bắt đầu (chơi lại thì đổi bên đi trước)
    main = (
      <>
        {!my && <span className="muted small ba-note">Bạn đang xem · {sitLabel}</span>}
        <StartBar players={players} ready={ready} waitingFor={s.waitingFor} seated={!!my}
          startLabel={over ? rematchLabel : 'Bắt đầu'} readyLabel={over ? 'Muốn chơi lại' : 'Sẵn sàng'} />
        {my && stand}
      </>
    );
  }
  return (
    <div className="board-actions">
      {main}
      {extra}
      {resign && (
        <ConfirmDialog title="Xin thua ván này?" danger okLabel="Xin thua" icon={<Flag size={22} />}
          onOk={() => act({ type: 'resign' })} onClose={() => setResign(false)}>
          Ván kết thúc ngay, <b>{s.seats[opp]?.name || 'đối thủ'}</b> thắng. Hành động này không cần đối thủ đồng ý và không hoàn tác được.
        </ConfirmDialog>
      )}
    </div>
  );
}
