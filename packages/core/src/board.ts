/**
 * Board model.
 *
 * Every player's checkers are stored in that player's own *path coordinates*:
 * position 0 is the start of the path (the "head" in long nardy, the 24-point in
 * backgammon) and position 23 is the last point before bearing off. Home is
 * positions 18..23. BAR (-1) and OFF (24) are virtual positions.
 *
 * Absolute coordinates (0..23) are used only for rendering. Absolute index i is the
 * point numbered i+1 from White's perspective: 0..5 bottom-right (White home),
 * 6..11 bottom-left, 12..17 top-left, 18..23 top-right.
 */

export type Variant = 'long' | 'short';
export type Color = 0 | 1; // 0 = white, 1 = black

export const BAR = -1;
export const OFF = 24;
export const CHECKERS = 15;
export const HOME_START = 18;

export interface Board {
  /** pts[color][pathPos] = number of that color's checkers on that point. */
  pts: [number[], number[]];
  bar: [number, number];
  off: [number, number];
}

export const other = (c: Color): Color => (c === 0 ? 1 : 0);

/** Converts a position in one player's path coordinates into the opponent's path coordinates. */
export function toOther(pos: number, variant: Variant): number {
  return variant === 'short' ? 23 - pos : (pos + 12) % 24;
}

/** Path position of `color` → absolute point index (0..23). */
export function toAbs(color: Color, pos: number, variant: Variant): number {
  if (color === 0) return 23 - pos;
  return variant === 'short' ? pos : (35 - pos) % 24;
}

/** Absolute point index → path position for `color`. */
export function fromAbs(color: Color, abs: number, variant: Variant): number {
  if (color === 0) return 23 - abs;
  return variant === 'short' ? abs : (35 - abs) % 24;
}

export function emptyBoard(): Board {
  return { pts: [new Array(24).fill(0), new Array(24).fill(0)], bar: [0, 0], off: [0, 0] };
}

export function initialBoard(variant: Variant): Board {
  const b = emptyBoard();
  for (const c of [0, 1] as Color[]) {
    const p = b.pts[c];
    if (variant === 'long') {
      p[0] = 15;
    } else {
      p[0] = 2; // 24-point
      p[11] = 5; // 13-point (mid-point)
      p[16] = 3; // 8-point
      p[18] = 5; // 6-point
    }
  }
  return b;
}

export function cloneBoard(b: Board): Board {
  return { pts: [b.pts[0].slice(), b.pts[1].slice()], bar: [b.bar[0], b.bar[1]], off: [b.off[0], b.off[1]] };
}

export function boardKey(b: Board): string {
  return b.pts[0].join(',') + '/' + b.pts[1].join(',') + '/' + b.bar.join(',') + '/' + b.off.join(',');
}

export function pipCount(b: Board, c: Color): number {
  let s = b.bar[c] * 25;
  const p = b.pts[c];
  for (let i = 0; i < 24; i++) s += p[i] * (24 - i);
  return s;
}

export function allHome(b: Board, c: Color): boolean {
  if (b.bar[c] > 0) return false;
  const p = b.pts[c];
  for (let i = 0; i < HOME_START; i++) if (p[i] > 0) return false;
  return true;
}

export function checkerTotal(b: Board, c: Color): number {
  let s = b.bar[c] + b.off[c];
  for (const n of b.pts[c]) s += n;
  return s;
}

/** Signed absolute view for rendering: +n white, -n black. */
export function absoluteView(b: Board, variant: Variant): number[] {
  const out = new Array(24).fill(0);
  for (let pos = 0; pos < 24; pos++) {
    out[toAbs(0, pos, variant)] += b.pts[0][pos];
    out[toAbs(1, pos, variant)] -= b.pts[1][pos];
  }
  return out;
}
