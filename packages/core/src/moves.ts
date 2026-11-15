import {
  BAR,
  Board,
  Color,
  HOME_START,
  OFF,
  Variant,
  allHome,
  boardKey,
  cloneBoard,
  other,
  toOther,
} from './board';

/** A single checker movement by one die, in the mover's path coordinates. */
export interface Step {
  from: number; // BAR or 0..23
  to: number; // 0..23 or OFF
  die: number;
  hit?: boolean;
}

/** Everything needed to decide what the mover may do next during a turn. */
export interface TurnState {
  variant: Variant;
  board: Board;
  player: Color;
  remaining: number[];
  /** Long nardy: checkers already taken from the head this turn, and the limit. */
  headMoved: number;
  headLimit: number;
}

/** Long nardy: two checkers may leave the head only on the first throw of 6-6, 4-4 or 3-3. */
export function headLimitFor(variant: Variant, dice: number[], isFirstTurn: boolean): number {
  if (variant !== 'long') return 15;
  if (isFirstTurn && dice.length === 4 && (dice[0] === 6 || dice[0] === 4 || dice[0] === 3)) return 2;
  return 1;
}

export function expandDice(d1: number, d2: number): number[] {
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}

export function applyStepToBoard(board: Board, me: Color, step: Step, variant: Variant): Board {
  const b = cloneBoard(board);
  if (step.from === BAR) b.bar[me]--;
  else b.pts[me][step.from]--;
  if (step.to === OFF) b.off[me]++;
  else {
    b.pts[me][step.to]++;
    if (step.hit) {
      const op = other(me);
      b.pts[op][toOther(step.to, variant)]--;
      b.bar[op]++;
    }
  }
  return b;
}

/**
 * Long nardy: a 6-point block is legal only if at least one opponent checker is
 * ahead of it. Only windows touching the point just landed on can be new.
 */
function violatesBlockRule(board: Board, me: Color, landed: number): boolean {
  const mine = board.pts[me];
  const theirs = board.pts[other(me)];
  const lo = Math.max(0, landed - 5);
  const hi = Math.min(landed, 18);
  for (let start = lo; start <= hi; start++) {
    let full = true;
    for (let k = 0; k < 6; k++) if (mine[start + k] === 0) { full = false; break; }
    if (!full) continue;
    // Block positions in opponent coordinates: start+12 .. start+17 (mod 24).
    const oStart = start + 12;
    const oEnd = start + 17;
    if (oStart < 24 && oEnd >= 24) continue; // wraps the end of the opponent's path: not a prime for them
    const maxOpp = oEnd % 24;
    let ahead = false;
    for (let q = maxOpp + 1; q < 24; q++) if (theirs[q] > 0) { ahead = true; break; }
    if (!ahead) return true;
  }
  return false;
}

/** Returns the step if moving a checker from `from` by `die` is allowed right now, else null. */
export function tryStep(ts: TurnState, from: number, die: number): Step | null {
  const { board, player: me, variant } = ts;
  const mine = board.pts[me];
  if (!Number.isInteger(die) || die < 1 || die > 6) return null;
  if (from !== BAR && !(Number.isInteger(from) && from >= 0 && from < 24)) return null;
  if (variant === 'short' && board.bar[me] > 0) {
    if (from !== BAR) return null;
  } else if (from === BAR) return null;
  if (from !== BAR && mine[from] <= 0) return null;
  if (variant === 'long' && from === 0 && ts.headMoved >= ts.headLimit) return null;

  const to = from === BAR ? die - 1 : from + die;
  if (to >= OFF) {
    if (!allHome(board, me)) return null;
    if (to > OFF) {
      for (let q = HOME_START; q < from; q++) if (mine[q] > 0) return null;
    }
    return { from, to: OFF, die };
  }
  const opp = board.pts[other(me)][toOther(to, variant)];
  if (variant === 'long') {
    if (opp > 0) return null;
    const step: Step = { from, to, die };
    if (violatesBlockRule(applyStepToBoard(board, me, step, variant), me, to)) return null;
    return step;
  }
  if (opp >= 2) return null;
  return opp === 1 ? { from, to, die, hit: true } : { from, to, die };
}

export function advance(ts: TurnState, step: Step): TurnState {
  const idx = ts.remaining.indexOf(step.die);
  const remaining = ts.remaining.slice();
  remaining.splice(idx, 1);
  return {
    ...ts,
    board: applyStepToBoard(ts.board, ts.player, step, ts.variant),
    remaining,
    headMoved: ts.headMoved + (ts.variant === 'long' && step.from === 0 ? 1 : 0),
  };
}

function uniqueDice(remaining: number[]): number[] {
  return remaining[0] === remaining[1] || remaining.length < 2 ? [remaining[0]] : [...new Set(remaining)];
}

function rawSteps(ts: TurnState): Step[] {
  const out: Step[] = [];
  if (ts.remaining.length === 0) return out;
  const dice = uniqueDice(ts.remaining);
  for (const die of dice) {
    if (ts.board.bar[ts.player] > 0) {
      const s = tryStep(ts, BAR, die);
      if (s) out.push(s);
      continue;
    }
    for (let from = 0; from < 24; from++) {
      if (ts.board.pts[ts.player][from] === 0) continue;
      const s = tryStep(ts, from, die);
      if (s) out.push(s);
    }
  }
  return out;
}

function nodeKey(ts: TurnState): string {
  return boardKey(ts.board) + '|' + ts.remaining.join('') + '|' + ts.headMoved;
}

export type Memo = Map<string, number>;

/** Maximum number of dice that can still be played from this turn state. */
export function maxUsable(ts: TurnState, memo: Memo = new Map()): number {
  if (ts.remaining.length === 0) return 0;
  const key = nodeKey(ts);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  let best = 0;
  for (const s of rawSteps(ts)) {
    const v = 1 + maxUsable(advance(ts, s), memo);
    if (v > best) best = v;
    if (best === ts.remaining.length) break;
  }
  memo.set(key, best);
  return best;
}

/**
 * Steps that can be played next such that the whole turn still uses the
 * maximum possible number of dice (and the larger die when only one can be played).
 */
export function legalNextSteps(ts: TurnState, memo: Memo = new Map()): Step[] {
  const total = maxUsable(ts, memo);
  if (total === 0) return [];
  let res = rawSteps(ts).filter((s) => 1 + maxUsable(advance(ts, s), memo) === total);
  if (total === 1 && ts.remaining.length === 2 && ts.remaining[0] !== ts.remaining[1]) {
    const big = Math.max(ts.remaining[0], ts.remaining[1]);
    if (res.some((s) => s.die === big)) res = res.filter((s) => s.die === big);
  }
  return res;
}

export interface TurnOption {
  steps: Step[];
  board: Board;
}

/** All distinct final positions reachable with a full legal turn (one representative step list each). */
export function allTurns(ts: TurnState): TurnOption[] {
  const memo: Memo = new Map();
  const visited = new Set<string>();
  const results = new Map<string, TurnOption>();
  const walk = (cur: TurnState, steps: Step[]) => {
    const k = nodeKey(cur);
    if (visited.has(k)) return;
    visited.add(k);
    const next = legalNextSteps(cur, memo);
    if (next.length === 0) {
      const bk = boardKey(cur.board);
      if (!results.has(bk)) results.set(bk, { steps, board: cur.board });
      return;
    }
    for (const s of next) walk(advance(cur, s), [...steps, s]);
  };
  walk(ts, []);
  return [...results.values()];
}

export interface Destination {
  to: number;
  steps: Step[];
}

/**
 * Where the checker standing on `from` can end up this turn, including
 * combined moves (several dice with the same checker). Shortest chains win.
 */
export function destinationsFrom(ts: TurnState, from: number, memo: Memo = new Map()): Destination[] {
  const found = new Map<number, Destination>();
  const walk = (cur: TurnState, pos: number, chain: Step[]) => {
    for (const s of legalNextSteps(cur, memo)) {
      if (s.from !== pos) continue;
      const nextChain = [...chain, s];
      const existing = found.get(s.to);
      if (!existing || existing.steps.length > nextChain.length) found.set(s.to, { to: s.to, steps: nextChain });
      if (s.to !== OFF) walk(advance(cur, s), s.to, nextChain);
    }
  };
  walk(ts, from, []);
  return [...found.values()];
}

/** Validates a full turn. Returns the resolved steps or an error string. */
export function validateTurn(ts: TurnState, input: { from: number; die: number }[]): { ok: true; steps: Step[]; end: TurnState } | { ok: false; error: string } {
  const memo: Memo = new Map();
  let cur = ts;
  const steps: Step[] = [];
  for (const inp of input) {
    const legal = legalNextSteps(cur, memo).find((s) => s.from === inp.from && s.die === inp.die);
    if (!legal) return { ok: false, error: 'illegal_step' };
    steps.push(legal);
    cur = advance(cur, legal);
  }
  if (legalNextSteps(cur, memo).length > 0) return { ok: false, error: 'incomplete_turn' };
  return { ok: true, steps, end: cur };
}
