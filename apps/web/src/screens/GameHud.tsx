import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { Icon } from '../components/icons';

export interface StripProps {
  name: string; offline: boolean; mine: boolean; active: boolean; statusText: string;
  pips: number; pipDiff: number;            // pipDiff > 0: this side is ahead by that many pips
  off: number; score: number; cube: ReactNode | null; pieceChip: ReactNode;
  bank: string | null; move: string | null; low: boolean;
}
export function PlayerStrip(p: StripProps) {
  const T = useT();
  const diff = p.pipDiff > 0 ? `${T.pipsAhead} ${p.pipDiff}` : p.pipDiff === 0 ? T.pipsEven : '';
  return (
    <div className={'strip' + (p.active ? ' active' : '') + (p.mine ? ' mine' : '')}>
      {p.pieceChip}
      <div className="strip-main">
        <div className="strip-name"><b title={p.name}>{p.name}</b>{p.offline && <span className="tag warn">{T.offline}</span>}{p.active && <span className="turn-now">{p.statusText}</span>}</div>
        <div className="pmeta" data-pips={p.mine ? 'me' : 'opp'}>{p.pips} {T.pips} · {p.off}/15</div>
        {diff && <span className={'pdiff' + (p.pipDiff > 0 ? ' ahead' : '')}>{diff}</span>}
      </div>
      <span className="strip-score" title={T.score}>{p.score}</span>
      {p.cube}
      {(p.bank || p.move) && <div className="strip-timers"><span className="bank-time" title={T.bank}>{p.bank ?? '—'}</span><span className={'move-time' + (p.low ? ' low' : '')} title={T.moveTimer}>{p.move ?? '—'}</span></div>}
    </div>
  );
}

export interface ActionBarProps {
  canUndo: boolean; undoCountdownMs: number | null; undo: () => void;
  canDone: boolean; done: () => void;
  onReact: (emoji: string) => void; emojis: readonly string[];
  onChat: (() => void) | null; chatDot: boolean;
  extra: ReactNode;                        // double / claim buttons, passed through
}
export function ActionBar(p: ActionBarProps) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const reactWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!reactWrap.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return (
    <div className="action-bar">
      <div className="react-wrap" ref={reactWrap}>
        <button className="round" aria-label={T.reactions} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="smile" /></button>
        {open && <div className="react-pop" role="menu">{p.emojis.map((e) => <button key={e} role="menuitem" aria-label={e} onClick={() => { p.onReact(e); setOpen(false); }}>{e}</button>)}</div>}
      </div>
      {p.onChat && <button className="round" aria-label={T.chat} onClick={p.onChat}><Icon name="chat" />{p.chatDot && <i className="dot" />}</button>}
      <button className={'btn' + (p.undoCountdownMs !== null ? ' primary undo-send' : '')} disabled={!p.canUndo} onClick={p.undo}>
        <Icon name="undo" size={16} /> {T.undo}
        {p.undoCountdownMs !== null && <i className="countdown" style={{ ['--ms' as string]: `${p.undoCountdownMs}ms` }} />}
      </button>
      <button className="btn primary" disabled={!p.canDone} onClick={p.done}><Icon name="check" size={16} /> {T.done}</button>
      <div className="action-extra">{p.extra}</div>
    </div>
  );
}

