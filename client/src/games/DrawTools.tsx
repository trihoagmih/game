// Thanh công cụ vẽ dùng chung (Vẽ đoán, Tam sao thất bản): màu, cỡ nét, bút / tẩy / đổ màu, hoàn tác, xóa.
import { useState } from 'react';
import { Pencil, Eraser, PaintBucket, Undo2, Trash2 } from 'lucide-react';
import { PALETTE, BRUSH_SIZES } from '@game/shared/scribble';
import { useHotkeys } from '../hooks.js';
import type { RefObject } from 'react';
import type { CanvasHandle } from './ScribbleCanvas.js';
import './DrawTools.css';

const TOOLS: [string, string, typeof Pencil, string][] = [['pen', 'Bút', Pencil, 'b'], ['eraser', 'Tẩy', Eraser, 'e'], ['fill', 'Đổ màu', PaintBucket, 'f']];

/** Trạng thái công cụ + phím tắt (B/E/F, Z hoàn tác, 1–5 cỡ nét) khi `enabled`. canvas: ref tới ScribbleCanvas. */
export function useDrawTools(canvas: RefObject<CanvasHandle | null>, enabled: boolean) {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(1);
  const [size, setSize] = useState(1);
  useHotkeys({
    b: () => setTool('pen'), e: () => setTool('eraser'), f: () => setTool('fill'), z: () => canvas.current?.undo(),
    1: () => setSize(0), 2: () => setSize(1), 3: () => setSize(2), 4: () => setSize(3), 5: () => setSize(4),
  }, enabled);
  return { tool, setTool, color, setColor, size, setSize, brush: BRUSH_SIZES[size] };
}

export type DrawToolState = ReturnType<typeof useDrawTools>;

export default function DrawTools({ t, canvas, className = '' }: { t: DrawToolState; canvas: RefObject<CanvasHandle | null>; className?: string }) {
  const { tool, setTool, color, setColor, size, setSize } = t;
  return (
    <div className={`sc-tools ${className}`} role="toolbar" aria-label="Công cụ vẽ">
      <div className="sc-palette">
        {PALETTE.map((c, i) => (
          <button key={c} className={`sc-color ${color === i && tool !== 'eraser' ? 'on' : ''}`} style={{ background: c }}
            onClick={() => { setColor(i); if (tool === 'eraser') setTool('pen'); }} aria-label={`Màu ${c}`} aria-pressed={color === i} />
        ))}
      </div>
      <div className="sc-sizes">
        {BRUSH_SIZES.map((w, i) => (
          <button key={w} className={`sc-size ${size === i ? 'on' : ''}`} onClick={() => setSize(i)} aria-label={`Cỡ nét ${w}`} title={`Cỡ ${i + 1}`}>
            <span style={{ width: Math.min(24, w), height: Math.min(24, w), background: PALETTE[color] }} />
          </button>
        ))}
      </div>
      <div className="sc-toolbtns">
        {TOOLS.map(([k, label, Icon, key]) => (
          <button key={k} className={`btn sm ${tool === k ? 'primary' : 'ghost'}`} onClick={() => setTool(k)} title={`${label} (${key.toUpperCase()})`} aria-pressed={tool === k}>
            <Icon size={16} aria-hidden /><span className="hide-sm"> {label}</span>
          </button>
        ))}
        <button className="btn sm ghost" onClick={() => canvas.current?.undo()} title="Hoàn tác (Z)"><Undo2 size={16} aria-hidden /><span className="hide-sm"> Hoàn tác</span></button>
        <button className="btn sm ghost danger-text" onClick={() => canvas.current?.clear()} title="Xóa hết"><Trash2 size={16} aria-hidden /><span className="hide-sm"> Xóa</span></button>
      </div>
    </div>
  );
}
