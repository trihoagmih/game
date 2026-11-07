// Soạn bộ câu hỏi Đố vui: lưu nhiều bộ trên trình duyệt, kiểm tra ngay khi gõ, nạp vào phòng.
import { useMemo, useState } from 'react';
import { Plus, Save, Trash2, Upload, Check, AlertTriangle } from 'lucide-react';
import { parseQuizText, QUIZ_TEMPLATE } from '@game/shared/quiz';
import Modal from './Modal.js';
import ConfirmDialog from './ConfirmDialog.js';
import './QuizEditor.css';

const KEY = 'gl_quiz_sets';
interface QuizSet { id: string; title: string; text: string; updated: number }
const isQuizSet = (v: unknown): v is QuizSet => !!v && typeof v === 'object'
  && 'id' in v && typeof v.id === 'string' && 'text' in v && typeof v.text === 'string' && 'title' in v && typeof v.title === 'string';
const load = (): QuizSet[] => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) || 'null');
    return Array.isArray(saved) ? saved.filter(isQuizSet) : [];
  } catch { return []; }
};
const store = (sets: QuizSet[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(sets)); return true; } catch { return false; }
};
const newId = () => Math.random().toString(36).slice(2, 10);
const titleOf = (text: string) => {
  try { return parseQuizText(text).title || 'Bộ chưa đặt tên'; } catch { return (text.match(/^#\s*(.+)$/m)?.[1] || 'Bộ chưa đặt tên').slice(0, 60); }
};

export default function QuizEditor({ onLoad, onClose }: { onLoad?: (text: string) => Promise<unknown>; onClose: () => void }) {
  const [sets, setSets] = useState(load);
  const [cur, setCur] = useState<string | null>(() => sets[0]?.id || null);
  const [text, setText] = useState(() => sets[0]?.text ?? QUIZ_TEMPLATE);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);

  const check = useMemo(() => {
    try { const r = parseQuizText(text); return { ok: true, n: r.questions.length, title: r.title }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }, [text]);

  const pick = (id: string | null) => {
    const s = sets.find((x) => x.id === id);
    setCur(id);
    setText(s ? s.text : QUIZ_TEMPLATE);
    setDirty(false);
  };

  const save = () => {
    const id = cur || newId();
    const item = { id, title: titleOf(text), text, updated: Date.now() };
    const next = [item, ...sets.filter((x) => x.id !== id)];
    store(next);
    setSets(next);
    setCur(id);
    setDirty(false);
    return item;
  };

  const loadIntoRoom = async () => {
    if (!check.ok || !onLoad) return;
    save();
    setBusy(true);
    const res = await onLoad(text);
    setBusy(false);
    if (res) onClose();
  };

  const remove = () => {
    const next = sets.filter((x) => x.id !== cur);
    store(next);
    setSets(next);
    setCur(next[0]?.id || null);
    setText(next[0]?.text ?? QUIZ_TEMPLATE);
    setDirty(false);
  };

  return (
    <Modal title="Bộ câu hỏi của bạn" onClose={onClose} wide>
      <div className="qe">
        <div className="qe-sets">
          <select value={cur || ''} onChange={(e) => (e.target.value === '__new' ? pick(null) : pick(e.target.value))} aria-label="Chọn bộ câu hỏi đã lưu">
            {!cur && <option value="">— Bộ mới (chưa lưu) —</option>}
            {sets.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            {cur && <option value="__new">+ Soạn bộ mới…</option>}
          </select>
          {cur && <button className="btn sm ghost" onClick={() => pick(null)}><Plus size={14} aria-hidden /> Bộ mới</button>}
        </div>
        <details className="qe-help">
          <summary>Cách viết</summary>
          <ul className="small muted">
            <li><code># Tên bộ</code> — dòng đầu (không bắt buộc)</li>
            <li><code>? Câu hỏi</code> — mỗi câu bắt đầu bằng dấu hỏi</li>
            <li><code>* Đáp án đúng</code> và <code>- Đáp án sai</code> — mỗi câu 2–4 đáp án, đúng một dấu <code>*</code></li>
            <li>Tối đa 50 câu. Khi chơi, thứ tự câu hỏi và đáp án được xáo ngẫu nhiên.</li>
          </ul>
        </details>
        <textarea className="qe-text" value={text} spellCheck={false} rows={16}
          onChange={(e) => { setText(e.target.value); setDirty(true); }} aria-label="Nội dung bộ câu hỏi" />
        <div className={`qe-status small ${check.ok ? 'ok' : 'bad'}`} role="status">
          {check.ok ? <><Check size={14} aria-hidden /> Hợp lệ: {check.n} câu{check.title ? ` · "${check.title}"` : ''}</> : <><AlertTriangle size={14} aria-hidden /> {check.error}</>}
        </div>
        <div className="row end qe-actions">
          {cur && <button className="btn ghost danger-text" onClick={() => setDel(true)}><Trash2 size={16} aria-hidden /> Xóa</button>}
          <button className="btn" onClick={save} disabled={!dirty && !!cur}><Save size={16} aria-hidden /> {dirty || !cur ? 'Lưu' : 'Đã lưu'}</button>
          {onLoad && (
            <button className="btn primary" onClick={loadIntoRoom} disabled={!check.ok || busy}><Upload size={16} aria-hidden /> Dùng bộ này</button>
          )}
        </div>
        <p className="muted small">Bộ câu hỏi được lưu trên trình duyệt này. Bấm "Dùng bộ này" để cả phòng chơi với bộ câu hỏi của bạn.</p>
      </div>
      {del && (
        <ConfirmDialog title="Xóa bộ câu hỏi này?" danger okLabel="Xóa" icon={<Trash2 size={22} />} onOk={remove} onClose={() => setDel(false)}>
          Bộ "{titleOf(text)}" sẽ bị xóa khỏi trình duyệt này.
        </ConfirmDialog>
      )}
    </Modal>
  );
}
