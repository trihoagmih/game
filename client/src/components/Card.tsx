import type { MouseEventHandler } from 'react';

interface CardProps {
  card?: string | null;
  size?: string;
  selected?: boolean;
  focused?: boolean;
  dim?: boolean;
  locked?: boolean;
  highlight?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  title?: string;
}

import { SUIT_SYMBOL, RANK_LABEL, isRed } from '@game/shared/cards';
import './Card.css';

/** Lá bài. card = "AS" | "??" (úp). */
export default function Card({ card, size = 'md', selected, focused, dim, locked, highlight, onClick, title }: CardProps) {
  if (!card || card === '??') {
    return <div className={`card back ${size}`} />;
  }
  const r = RANK_LABEL[card[0]] || card[0];
  const s = SUIT_SYMBOL[card[1]];
  const cls = [
    'card', size, isRed(card) ? 'red' : 'black',
    selected && 'selected', focused && 'focused', dim && 'dim', locked && 'locked', highlight && 'highlight',
    onClick && 'clickable',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={onClick} title={title}>
      <span className="c-rank">{r}</span>
      <span className="c-suit">{s}</span>
      <span className="c-big">{s}</span>
    </div>
  );
}
