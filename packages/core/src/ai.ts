import { Board, Color, Variant, other, pipCount, toOther } from './board';
import { Step, TurnOption, allTurns, expandDice, headLimitFor } from './moves';
import { MatchState, canDouble, turnState } from './game';

export type AiLevel = 'beginner' | 'amateur' | 'master';

/** The 21 distinct rolls with their weight out of 36. */
export const ROLLS: { d: [number, number]; w: number }[] = (() => {
  const out: { d: [number, number]; w: number }[] = [];
  for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) out.push({ d: [a, b], w: a === b ? 1 : 2 });
  return out;
})();

// ───────────────────────────── short (backgammon) ─────────────────────────────

/** Opponent checker positions mapped into `me`'s coordinates (opponent moves toward lower numbers). */
function oppInMyCoords(board: Board, me: Color): number[] {
  const op = board.pts[other(me)];
  const res = new Array(24).fill(0);
  for (let q = 0; q < 24; q++) if (op[q]) res[23 - q] = op[q];
  return res;
}

function shortEval(board: Board, me: Color): number {
  const op = other(me);
  const mine = board.pts[me];
  const theirs = oppInMyCoords(board, me);
  const myPips = pipCount(board, me);
  const opPips = pipCount(board, op);

  let myRear = board.bar[me] > 0 ? -1 : 24;
  for (let p = 0; p < 24 && myRear === 24; p++) if (mine[p]) myRear = p;
  let opRear = board.bar[op] > 0 ? 24 : -1;
  for (let x = 23; x >= 0 && opRear === -1; x--) if (theirs[x]) opRear = x;

  if (myRear > opRear) {
    // Pure race. The opponent is on roll, worth ~8 pips.
    return (opPips - myPips - 8) * 1.2 + (board.off[me] - board.off[op]) * 0.5;
  }

  let score = (opPips - myPips) * 0.45;

  // Made points, home board, primes.
  let run = 0;
  let bestRun = 0;
  for (let p = 0; p < 24; p++) {
    if (mine[p] >= 2) {
      run++;
      if (run > bestRun) bestRun = run;
      if (p >= 18) score += 2.6 + (p >= 19 && p <= 22 ? 0.8 : 0);
      else if (p >= 12) score += 1.4;
      else if (p <= 5) score += 1.6; // anchor
      if (mine[p] > 3) score -= (mine[p] - 3) * 0.6;
    } else run = 0;
  }
  if (bestRun >= 3) score += (bestRun - 2) * (bestRun - 2) * 2.2;

  // Opponent checkers on the bar are great, more so with a strong home board.
  let homePoints = 0;
  for (let p = 18; p < 24; p++) if (mine[p] >= 2) homePoints++;
  score += board.bar[op] * (5 + homePoints * 1.5);
  score -= board.bar[me] * 6;

  // Blot exposure: expected pip/tempo loss over the opponent's 36 rolls.
  const blots: number[] = [];
  for (let p = 0; p < 24; p++) if (mine[p] === 1) blots.push(p);
  if (blots.length) {
    const shooters: number[] = [];
    if (board.bar[op] > 0) shooters.push(24);
    for (let x = 0; x < 24; x++) if (theirs[x]) shooters.push(x);
    let exposure = 0;
    for (const { d, w } of ROLLS) {
      const dists = d[0] === d[1] ? [d[0], d[0] * 2, d[0] * 3, d[0] * 4] : [d[0], d[1], d[0] + d[1]];
      let worst = 0;
      for (const b of blots) {
        let hit = false;
        for (const s of shooters) {
          if (s <= b) continue;
          const dist = s - b;
          if (dists.includes(dist)) { hit = true; break; }
        }
        if (hit) {
          const loss = b + 1 + (b >= 18 ? 6 : 0) + homePointsOpp(board, me) * 1.2;
          if (loss > worst) worst = loss;
        }
      }
      exposure += worst * w;
    }
    score -= (exposure / 36) * 0.9;
  }
  return score;
}

function homePointsOpp(board: Board, me: Color): number {
  const theirs = board.pts[other(me)];
  let n = 0;
  for (let q = 18; q < 24; q++) if (theirs[q] >= 2) n++;
  return n;
}

// ───────────────────────────── long nardy ─────────────────────────────

/** Blocking strength of `side` against its opponent, plus structural terms. */
function longFeatures(board: Board, side: Color, variant: Variant): number {
  const mine = board.pts[side];
  const opp = other(side);
  const theirs = board.pts[opp];
  // Opponent's rearmost checker, in the opponent's own coordinates.
  let oppRear = 24;
  for (let q = 0; q < 24; q++) if (theirs[q]) { oppRear = q; break; }
  // My occupancy in opponent coordinates.
  const occ = new Array(24).fill(false);
  for (let p = 0; p < 24; p++) if (mine[p]) occ[toOther(p, variant)] = true;
  let score = 0;
  let run = 0;
  for (let q = oppRear + 1; q < 24; q++) {
    if (occ[q]) {
      run++;
      // Points directly in front of the opponent's rear checkers are worth more.
      score += q - oppRear <= 6 ? 1.1 : 0.5;
    } else {
      if (run >= 2) score += run * run * 0.9;
      run = 0;
    }
  }
  if (run >= 2) score += run * run * 0.9;

  let distinct = 0;
  for (let p = 1; p < 18; p++) {
    if (mine[p]) distinct++;
    if (mine[p] > 3) score -= (mine[p] - 3) * 0.7;
  }
  score += distinct * 0.8;
  // Lingering on the head is costly once the game is under way.
  if (mine[0] > 0) score -= Math.max(0, mine[0] - 1) * 0.9;
  return score;
}

function longEval(board: Board, me: Color): number {
  const op = other(me);
  const pipDiff = pipCount(board, op) - pipCount(board, me);
  return pipDiff * 0.9 + longFeatures(board, me, 'long') - longFeatures(board, op, 'long') + (board.off[me] - board.off[op]) * 0.4;
}

/** Positional evaluation from `me`'s point of view right after `me` moved (opponent on roll). */
export function evaluate(board: Board, me: Color, variant: Variant): number {
  if (board.off[me] === 15) return 1000;
  if (board.off[other(me)] === 15) return -1000;
  return variant === 'long' ? longEval(board, me) : shortEval(board, me);
}

/** Rough probability that `player` (who is on roll) wins the game. */
export function winProbability(board: Board, player: Color, variant: Variant): number {
  const e = -evaluate(board, other(player), variant);
  return 1 / (1 + Math.exp(-e / 11));
}

function bestReply(board: Board, player: Color, variant: Variant, dice: [number, number], firstTurn: boolean): number {
  const expanded = expandDice(dice[0], dice[1]);
  const opts = allTurns({ variant, board, player, remaining: expanded, headMoved: 0, headLimit: headLimitFor(variant, expanded, firstTurn) });
  if (opts.length === 0) return evaluate(board, player, variant);
  let best = -Infinity;
  for (const o of opts) {
    const v = evaluate(o.board, player, variant);
    if (v > best) best = v;
  }
  return best;
}

export function chooseTurn(m: MatchState, level: AiLevel, random: () => number = Math.random): Step[] {
  const ts = turnState(m);
  const me = m.turn;
  const variant = m.settings.variant;
  const options: TurnOption[] = allTurns(ts);
  if (options.length === 0) return [];
  if (options.length === 1) return options[0].steps;

  const scored = options.map((o) => ({ o, v: evaluate(o.board, me, variant) }));
  scored.sort((a, b) => b.v - a.v);

  if (level === 'beginner') {
    if (random() < 0.45) return options[Math.floor(random() * options.length)].steps;
    // Otherwise pick among the top third with noise.
    const pool = scored.slice(0, Math.max(1, Math.ceil(scored.length / 3)));
    return pool[Math.floor(random() * pool.length)].o.steps;
  }
  if (level === 'amateur') return scored[0].o.steps;

  // Master: 1-ply expectimax over the opponent's 21 rolls on the top candidates.
  const op = other(me);
  const candidates = scored.slice(0, Math.min(8, scored.length));
  const oppFirst = m.turnsTaken[op] === 0;
  let bestSteps = candidates[0].o.steps;
  let bestVal = -Infinity;
  for (const c of candidates) {
    if (c.o.board.off[me] === 15) return c.o.steps;
    let total = 0;
    for (const { d, w } of ROLLS) total += -bestReply(c.o.board, op, variant, d, oppFirst) * w;
    const val = total / 36 + c.v * 0.15;
    if (val > bestVal) {
      bestVal = val;
      bestSteps = c.o.steps;
    }
  }
  return bestSteps;
}

/** Should `player` offer a double before rolling? */
export function shouldDouble(m: MatchState, player: Color, level: AiLevel): boolean {
  if (!canDouble(m, player)) return false;
  const p = winProbability(m.board, player, m.settings.variant);
  const need = m.settings.matchLength - m.score[player];
  if (need <= m.cube.value) return false; // already enough to win the match
  const threshold = level === 'beginner' ? 0.6 : 0.7;
  return p > threshold && p < 0.92;
}

/** Should `player` accept the opponent's double? */
export function shouldTake(m: MatchState, player: Color, level: AiLevel): boolean {
  // Opponent is on roll.
  const pOpp = winProbability(m.board, other(player), m.settings.variant);
  const threshold = level === 'beginner' ? 0.85 : 0.76;
  return pOpp < threshold;
}

