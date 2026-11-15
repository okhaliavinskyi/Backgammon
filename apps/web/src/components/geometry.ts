import { BAR, Board, Color, OFF, Variant, toOther } from '@nardy/core';

/**
 * Board geometry in SVG units (viewBox 0 0 1000 800).
 * "Slots" are display positions 0..23 from the viewer's perspective:
 * slot = 23 - viewerPathPos, so the viewer's home is slots 0..5 (bottom right)
 * and the viewer always moves counter-clockwise.
 */
export const VB_W = 1000;
export const VB_H = 800;
export const FRAME = 24;
export const PW = 64; // point width
export const LEFT_X = FRAME;
export const BAR_X = LEFT_X + PW * 6; // 408
export const BAR_W = 60;
export const RIGHT_X = BAR_X + BAR_W; // 468
export const FIELD_END = RIGHT_X + PW * 6; // 852
export const TRAY_X = FIELD_END + 20; // 872
export const TRAY_W = 104;
export const TOP = FRAME;
export const BOTTOM = VB_H - FRAME;
export const POINT_LEN = 320;
export const R = 29;
export const MID_Y = VB_H / 2;

export function slotX(slot: number): number {
  if (slot <= 5) return RIGHT_X + (5 - slot) * PW + PW / 2;
  if (slot <= 11) return LEFT_X + (11 - slot) * PW + PW / 2;
  if (slot <= 17) return LEFT_X + (slot - 12) * PW + PW / 2;
  return RIGHT_X + (slot - 18) * PW + PW / 2;
}

export const isTop = (slot: number) => slot >= 12;

/** Spacing between stacked checkers on a point. */
export function stackSpacing(n: number): number {
  if (n <= 5) return R * 2;
  return (POINT_LEN - R * 2) / (n - 1);
}

export function checkerPos(slot: number, k: number, n: number): { x: number; y: number } {
  const sp = stackSpacing(n);
  const x = slotX(slot);
  const y = isTop(slot) ? TOP + R + k * sp : BOTTOM - R - k * sp;
  return { x, y };
}

export const TRAY_CX = TRAY_X + TRAY_W / 2;
export const SLAB_H = 14;

/** Borne-off checkers are drawn as slabs in the tray: viewer bottom, opponent top. */
export function offPos(mine: boolean, k: number): { x: number; y: number } {
  return { x: TRAY_CX, y: mine ? BOTTOM - 10 - SLAB_H / 2 - k * (SLAB_H + 1) : TOP + 10 + SLAB_H / 2 + k * (SLAB_H + 1) };
}

export function barPos(mine: boolean, k: number): { x: number; y: number } {
  const x = BAR_X + BAR_W / 2;
  return { x, y: mine ? MID_Y + 48 + k * 26 : MID_Y - 48 - k * 26 };
}

/** Path position of `color` → display slot for `viewer`. */
export function slotOf(color: Color, pos: number, viewer: Color, variant: Variant): number {
  const viewerPos = color === viewer ? pos : toOther(pos, variant);
  return 23 - viewerPos;
}

/** Display slot → path position for `color`. */
export function posOfSlot(slot: number, color: Color, viewer: Color, variant: Variant): number {
  const viewerPos = 23 - slot;
  return color === viewer ? viewerPos : toOther(viewerPos, variant);
}

export type Loc = string; // 's0'..'s23' | 'bar' | 'off'

export function locOf(color: Color, pos: number, viewer: Color, variant: Variant): Loc {
  if (pos === BAR) return 'bar';
  if (pos === OFF) return 'off';
  return 's' + slotOf(color, pos, viewer, variant);
}

export function locCounts(board: Board, color: Color, viewer: Color, variant: Variant): Map<Loc, number> {
  const m = new Map<Loc, number>();
  for (let p = 0; p < 24; p++) if (board.pts[color][p]) m.set(locOf(color, p, viewer, variant), board.pts[color][p]);
  if (board.bar[color]) m.set('bar', board.bar[color]);
  if (board.off[color]) m.set('off', board.off[color]);
  return m;
}

/**
 * Keeps checker identities stable between boards so that CSS transitions
 * animate the checkers that actually moved.
 */
export function assignIds(prev: Map<Loc, number[]> | null, counts: Map<Loc, number>, color: Color): Map<Loc, number[]> {
  const next = new Map<Loc, number[]>();
  if (!prev) {
    let id = color * 100;
    for (const [loc, n] of counts) next.set(loc, Array.from({ length: n }, () => id++));
    return next;
  }
  const pool: number[] = [];
  for (const [loc, ids] of prev) {
    const n = counts.get(loc) ?? 0;
    next.set(loc, ids.slice(0, n));
    pool.push(...ids.slice(n));
  }
  for (const [loc, n] of counts) {
    const cur = next.get(loc) ?? [];
    while (cur.length < n) cur.push(pool.shift()!);
    next.set(loc, cur);
  }
  for (const [loc, ids] of next) if (ids.length === 0) next.delete(loc);
  return next;
}
