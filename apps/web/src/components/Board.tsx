import { memo, useMemo, useRef, useState } from 'react';
import type { Board as BoardT, Color, Variant } from '@nardy/core';
import {
  BAR_W,
  BAR_X,
  LEFT_X,
  Loc,
  PW,
  R,
  RIGHT_X,
  SLAB_H,
  TRAY_W,
  TRAY_X,
  VB_W,
  geom,
  assignIds,
  isTop,
  locCounts,
  slotX,
} from './geometry';
import { BoardTheme, THEMES, HINT_FILL_W, HINT_EDGE_W } from './themes';
import type { Theme } from '../lib/settings';

export interface BoardProps {
  board: BoardT;
  vertical: boolean;
  variant: Variant;
  viewer: Color;
  theme: Theme;
  moveMs: number;
  /** Display locations whose top checker may move now. */
  movable: Set<Loc>;
  selected: Loc | null;
  targets: Set<Loc>;
  lastMove: Set<Loc>;
  /** Colour whose checkers `movable` refers to. */
  mover: Color | null;
  /** Draw movable rings and target highlights. */
  hints: boolean;
  onLocClick: (loc: Loc) => void;
  onDrop: (from: Loc, to: Loc) => void;
  label?: string;
}

// ───────────────────────────── static board ─────────────────────────────

const Defs = ({ th, id, vertical }: { th: BoardTheme; id: string; vertical: boolean }) => (
  <defs>
    <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.09" numOctaves="3" seed="7" />
      <feColorMatrix type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.13  0 0 0 0 0.05  0 0 0 1.1 -0.35" />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>
    <filter id={`${id}-malachite`} x="0" y="0" width="100%" height="100%">
      <feTurbulence type="turbulence" baseFrequency="0.006 0.018" numOctaves="4" seed="3" />
      <feColorMatrix type="matrix" values="0 0 0 0 0.02  0 0 0 0 0.25  0 0 0 0 0.16  0 0 0 2.2 -0.6" />
      <feComposite in2="SourceGraphic" operator="in" />
    </filter>
    <filter id={`${id}-shadow`} x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx={vertical ? 3 : 0} dy={vertical ? 0 : 3} stdDeviation="2.5" floodColor="#000" floodOpacity="0.45" />
    </filter>
    <filter id={`${id}-lift`} x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx={vertical ? 8 : 0} dy={vertical ? 0 : 8} stdDeviation="5" floodColor="#000" floodOpacity="0.45" />
    </filter>
    <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b" />
      <feMerge>
        <feMergeNode in="b" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    {(['white', 'black'] as const).map((c) => (
      <radialGradient key={c} id={`${id}-ck-${c}`} cx="38%" cy="32%" r="75%">
        <stop offset="0" stopColor={th[c].light} />
        <stop offset="0.55" stopColor={th[c].base} />
        <stop offset="1" stopColor={th[c].dark} />
      </radialGradient>
    ))}
    <linearGradient id={`${id}-frame`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={th.frame} />
      <stop offset="1" stopColor={th.frameDark} />
    </linearGradient>
  </defs>
);

type Geometry = ReturnType<typeof geom>;

function pointPath(slot: number, g: Geometry): string {
  const { TOP, BOTTOM, POINT_LEN } = g;
  const cx = slotX(slot);
  const half = PW / 2 - 2;
  if (isTop(slot)) return `M${cx - half},${TOP} L${cx + half},${TOP} L${cx},${TOP + POINT_LEN} Z`;
  return `M${cx - half},${BOTTOM} L${cx + half},${BOTTOM} L${cx},${BOTTOM - POINT_LEN} Z`;
}

const StaticBoard = memo(function StaticBoard({ th, id, g, vertical }: { th: BoardTheme; id: string; g: Geometry; vertical: boolean }) {
  const { TOP, BOTTOM, MID_Y, VB_H } = g;
  const fieldRects = [
    { x: LEFT_X, w: PW * 6 },
    { x: RIGHT_X, w: PW * 6 },
  ];
  return (
    <g>
      <rect x="0" y="0" width={VB_W} height={VB_H} rx="18" fill={`url(#${id}-frame)`} />
      {th.fieldTexture === 'wood' && <rect x="0" y="0" width={VB_W} height={VB_H} rx="18" fill="#000" filter={`url(#${id}-grain)`} opacity="0.55" />}
      {fieldRects.map((f, i) => (
        <g key={i}>
          <rect x={f.x} y={TOP} width={f.w} height={BOTTOM - TOP} fill={th.field} />
          {th.fieldTexture === 'wood' && <rect x={f.x} y={TOP} width={f.w} height={BOTTOM - TOP} fill="#000" filter={`url(#${id}-grain)`} opacity="0.35" />}
          {th.fieldTexture === 'malachite' && <rect x={f.x} y={TOP} width={f.w} height={BOTTOM - TOP} fill="#000" filter={`url(#${id}-malachite)`} opacity="0.9" />}
          <rect x={f.x + 3} y={TOP + 3} width={f.w - 6} height={BOTTOM - TOP - 6} fill="none" stroke={th.inlay} strokeOpacity="0.35" strokeWidth="1.5" />
        </g>
      ))}
      {Array.from({ length: 24 }, (_, s) => (
        <path key={s} d={pointPath(s, g)} fill={s % 2 === 0 ? th.pointA : th.pointB} stroke={th.pointStroke} strokeWidth="1" />
      ))}
      <rect x={BAR_X} y={TOP - 6} width={BAR_W} height={BOTTOM - TOP + 12} fill={th.bar} />
      {th.fieldTexture === 'wood' && <rect x={BAR_X} y={TOP - 6} width={BAR_W} height={BOTTOM - TOP + 12} fill="#000" filter={`url(#${id}-grain)`} opacity="0.5" />}
      <line x1={BAR_X + BAR_W / 2} y1={TOP + 8} x2={BAR_X + BAR_W / 2} y2={BOTTOM - 8} stroke={th.inlay} strokeOpacity="0.4" strokeDasharray="2 10" />
      <rect x={TRAY_X} y={TOP} width={TRAY_W} height={BOTTOM - TOP} rx="8" fill={th.tray} />
      <line x1={TRAY_X + 8} y1={MID_Y} x2={TRAY_X + TRAY_W - 8} y2={MID_Y} stroke={th.inlay} strokeOpacity="0.45" />
      {Array.from({ length: 24 }, (_, s) => (
        <text key={s} transform={vertical ? `rotate(-90 ${slotX(s)} ${isTop(s) ? TOP - 7 : BOTTOM + 17})` : undefined} x={slotX(s)} y={isTop(s) ? TOP - 7 : BOTTOM + 17} fontSize="12" textAnchor="middle" fill={th.inlay} opacity="0.75" style={{ userSelect: 'none' }}>
          {s + 1}
        </text>
      ))}
    </g>
  );
});

// ───────────────────────────── board ─────────────────────────────

interface CheckerRender {
  id: number;
  color: Color;
  loc: Loc;
  x: number;
  y: number;
  slab: boolean;
  top: boolean; // top of its stack
  count: number; // stack size (for label)
}

export function BoardView(p: BoardProps) {
  const g = useMemo(() => geom(p.vertical ? 660 : 800), [p.vertical]);
  const { BOTTOM, MID_Y, VB_H, checkerPos, offPos, barPos, locAt } = g;
  const th = THEMES[p.theme];
  const uid = 'b' + p.theme;
  const idsRef = useRef<[Map<Loc, number[]> | null, Map<Loc, number[]> | null]>([null, null]);
  const prevLocRef = useRef(new Map<number, Loc>());
  const lastMovedRef = useRef(new Set<number>());
  const viewKey = `${p.viewer}:${p.variant}`;
  const viewKeyRef = useRef(viewKey);
  if (viewKeyRef.current !== viewKey) {
    idsRef.current = [null, null];
    viewKeyRef.current = viewKey;
  }

  const checkers = useMemo(() => {
    const out: CheckerRender[] = [];
    const moved = new Set<number>();
    for (const color of [0, 1] as Color[]) {
      const counts = locCounts(p.board, color, p.viewer, p.variant);
      const ids = assignIds(idsRef.current[color], counts, color);
      idsRef.current[color] = ids;
      const mine = color === p.viewer;
      for (const [loc, list] of ids) {
        list.forEach((id, k) => {
          let pos: { x: number; y: number };
          if (loc === 'off') pos = offPos(mine, k);
          else if (loc === 'bar') pos = barPos(mine, k, list.length);
          else pos = checkerPos(Number(loc.slice(1)), k, list.length);
          if (prevLocRef.current.get(id) !== loc) moved.add(id);
          prevLocRef.current.set(id, loc);
          out.push({ id, color, loc, ...pos, slab: loc === 'off', top: k === list.length - 1, count: list.length });
        });
      }
    }
    if (moved.size) lastMovedRef.current = moved;
    // Draw recently moved checkers last so they fly above the others.
    const lm = lastMovedRef.current;
    out.sort((a, b) => Number(lm.has(a.id)) - Number(lm.has(b.id)) || a.id - b.id);
    return out;
  }, [p.board, p.viewer, p.variant, g]);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ from: Loc; id: number; sx: number; sy: number; active: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ id: number; x: number; y: number } | null>(null);

  const toSvg = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const X = ((e.clientX - r.left) / r.width) * (p.vertical ? 660 : VB_W);
    const Y = ((e.clientY - r.top) / r.height) * (p.vertical ? VB_W : 800);
    return p.vertical ? { x: Y, y: 660 - X } : { x: X, y: Y };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = toSvg(e);
    const loc = locAt(x, y);
    if (!loc) return;
    if (p.movable.has(loc)) {
      const top = checkers.find((c) => c.loc === loc && c.top && c.color === p.mover);
      if (top) {
        drag.current = { from: loc, id: top.id, sx: x, sy: y, active: false };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toSvg(e);
    if (!d.active && Math.hypot(x - d.sx, y - d.sy) > 10) d.active = true;
    if (d.active) setGhost({ id: d.id, x, y });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const { x, y } = toSvg(e);
    const loc = locAt(x, y);
    if (d?.active) {
      setGhost(null);
      if (loc && loc !== d.from) p.onDrop(d.from, loc);
      return;
    }
    if (loc) p.onLocClick(loc);
  };

  const dimSet = useRef(p.movable);
  // Keep the legal movable set while a fragment is animating.
  if (p.movable.size || p.targets.size) dimSet.current = p.movable;
  const ms = p.moveMs;

  return (
    <svg
      ref={svgRef}
      className="board-svg"
      viewBox={p.vertical ? '0 0 660 1000' : `0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label={p.label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setGhost(null);
      }}
    >
      <Defs th={th} id={uid} vertical={p.vertical} />
      <g transform={p.vertical ? 'matrix(0 1 -1 0 660 0)' : undefined}>
      <StaticBoard th={th} id={uid} g={g} vertical={p.vertical} />

      {/* last move markers */}
      {[...p.lastMove].map((loc) =>
        loc.startsWith('s') ? (
          <path key={'lm' + loc} d={pointPath(Number(loc.slice(1)), g)} fill={th.highlight} opacity="0.18" pointerEvents="none" />
        ) : null,
      )}

      {/* selection target highlights */}
      {[...(p.hints ? p.targets : [])].map((loc) => {
        if (loc === 'off') {
          return <g key="t-off" data-hint="target-off" pointerEvents="none">
            <rect x={TRAY_X + 3} y={MID_Y + 4} width={TRAY_W - 6} height={BOTTOM - MID_Y - 7} rx="8" fill={th.hint.fill} fillOpacity="0.22" stroke={th.hint.edge} strokeWidth={HINT_EDGE_W} />
            <rect x={TRAY_X + 3} y={MID_Y + 4} width={TRAY_W - 6} height={BOTTOM - MID_Y - 7} rx="8" fill="none" stroke={th.hint.fill} strokeWidth={HINT_FILL_W} />
          </g>;
        }
        const slot = Number(loc.slice(1));
        const n = checkers.filter((c) => c.loc === loc).length;
        const pos = checkerPos(slot, n, n + 1);
        return (
          <g key={'t' + loc} data-hint="target" pointerEvents="none">
            <path d={pointPath(slot, g)} fill={th.hint.fill} fillOpacity="0.22" stroke={th.hint.edge} strokeWidth={HINT_EDGE_W} />
            <path d={pointPath(slot, g)} fill="none" stroke={th.hint.fill} strokeWidth={HINT_FILL_W} />
            <circle cx={pos.x} cy={pos.y} r={R - 3} fill={`url(#${uid}-ck-${p.mover === 0 ? 'white' : 'black'})`} fillOpacity="0.45" stroke={th.hint.edge} strokeWidth={HINT_EDGE_W} />
            <circle cx={pos.x} cy={pos.y} r={R - 3} fill="none" stroke={th.hint.fill} strokeWidth={HINT_FILL_W} />
          </g>
        );
      })}

      {/* checkers */}
      {checkers.map((c) => {
        const col = c.color === 0 ? th.white : th.black;
        const isGhost = ghost?.id === c.id;
        const x = isGhost ? ghost!.x : c.x;
        const y = isGhost ? ghost!.y : c.y;
        const movable = p.hints && c.top && c.color === p.mover && p.movable.has(c.loc);
        const selected = p.hints && c.top && c.color === p.mover && p.selected === c.loc;
        return (
          <g
            key={c.id}
            data-checker={c.id}
            data-loc={c.loc}
            data-color={c.color}
            className={'ck' + (isGhost ? ' dragging' : '')}
            style={{ opacity: p.hints && p.mover === c.color && dimSet.current.size > 0 && !(c.top && dimSet.current.has(c.loc)) ? th.dim : 1, transform: `translate(${x}px, ${y}px)`, transitionDuration: isGhost ? '0ms' : `${ms}ms` }}
            pointerEvents="none"
          >
            {c.slab ? (
              <rect x={-TRAY_W / 2 + 10} y={-SLAB_H / 2} width={TRAY_W - 20} height={SLAB_H} rx="4" fill={`url(#${uid}-ck-${c.color === 0 ? 'white' : 'black'})`} stroke={col.ring} strokeWidth="1" />
            ) : (
              <g filter={`url(#${uid}-${selected ? 'lift' : 'shadow'})`}>
                <circle r={R} fill={`url(#${uid}-ck-${c.color === 0 ? 'white' : 'black'})`} stroke={col.dark} strokeWidth="1.5" />
                {(c.top || c.count <= 5) && <><circle r={R - 7} fill="none" stroke={col.ring} strokeWidth="2" opacity="0.8" />
                <circle r={R - 15} fill="none" stroke={col.ring} strokeWidth="1.2" opacity="0.55" /></>}
                {(movable || selected) && (
                  <g data-hint={selected ? 'selected' : 'movable'}>
                    <circle r={R - 3} fill="none" stroke={th.hint.edge} strokeWidth={HINT_EDGE_W + (selected ? 4 : 0)} />
                    <circle r={R - 3} fill="none" stroke={th.hint.fill} strokeWidth={HINT_FILL_W + (selected ? 4 : 0)} />
                  </g>
                )}
                {c.top && c.count > 5 && (
                  <text transform={p.vertical ? 'rotate(-90)' : undefined} y="0" dominantBaseline="central" fontSize="26" fontWeight="700" textAnchor="middle" fill={c.color === 0 ? '#3a2a14' : '#fff'}>
                    {c.count}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
      </g>
    </svg>
  );
}
