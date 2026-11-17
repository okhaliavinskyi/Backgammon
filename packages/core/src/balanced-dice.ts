import { other, pipCount, toOther, type Color } from './board';
import type { MatchState, Rng } from './game';
import { allTurns, expandDice, headLimitFor } from './moves';

export type DicePair = [number, number];
export const DICE_POLICY = 'balanced-v2';

/** Complete one own turn. Only a new blocked turn can restart the cooldown. */
export function recordDiceTurnResult(m: MatchState, player: Color, blocked: boolean): void {
  m.blockedTurns ??= [[], []];
  m.catchupCooldown ??= [0, 0];
  const recent = [...m.blockedTurns[player], blocked].slice(-5);
  m.blockedTurns[player] = recent;
  m.catchupCooldown[player] = Math.max(0, m.catchupCooldown[player] - 1);
  if (blocked && recent.filter(Boolean).length >= 2) m.catchupCooldown[player] = 5;
}
const pairKey = (d: DicePair) => [...d].sort().join(':');
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** No future interaction is possible along either player's remaining path. */
export function isPureRace(m: MatchState): boolean {
  if (m.board.bar.some(Boolean)) return false;
  for (const me of [0, 1] as const) {
    const rear = m.board.pts[me].findIndex(n => n > 0);
    if (rear < 0) continue;
    for (let p = 0; p < 24; p++) {
      if (m.board.pts[other(me)][p] && toOther(p, m.settings.variant) >= rear) return false;
    }
  }
  return true;
}

export function catchupStrength(m: MatchState): number {
  if ((m.catchupCooldown?.[m.turn] ?? 0) > 0) return 0;
  const mine = pipCount(m.board, m.turn);
  const theirs = pipCount(m.board, other(m.turn));
  if (theirs === 0 || !isPureRace(m)) return 0;
  const gap = mine - theirs;
  return Math.min(clamp((gap - 25) / 25), clamp((gap / theirs - 0.25) / 0.25));
}

/** Ordered pairs preserve the normal 2:1 frequency of non-doubles to doubles. */
export function balancedDiceWeights(m: MatchState): { dice: DicePair; weight: number }[] {
  const history = m.recentDice?.[m.turn] ?? [];
  const last = history.at(-1), previous = history.at(-2);
  const strength = catchupStrength(m);
  const before = pipCount(m.board, m.turn);
  const rolls = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    const dice: DicePair = [a, b];
    const key = pairKey(dice);
    const repeatLast = last && pairKey(last) === key;
    const repeatPrevious = previous && pairKey(previous) === key;
    const weight = repeatLast && repeatPrevious ? 0.25 : repeatLast ? 0.65 : repeatPrevious ? 0.85 : 1;
    let gain = 0;
    if (strength) {
      const remaining = expandDice(a, b);
      const options = allTurns({ variant: m.settings.variant, board: m.board, player: m.turn,
        remaining, headMoved: 0, headLimit: headLimitFor(m.settings.variant, remaining, m.turnsTaken[m.turn] === 0) });
      for (const option of options) gain = Math.max(gain, before - pipCount(option.board, m.turn));
    }
    rolls.push({ dice, weight, gain });
  }
  const min = Math.min(...rolls.map(r => r.gain));
  const max = Math.max(...rolls.map(r => r.gain));
  return rolls.map(({ dice, weight, gain }) => ({ dice,
    weight: weight * (max > min ? 1 + strength * 0.2 * (2 * (gain - min) / (max - min) - 1) : 1) }));
}

export function balancedRoll(m: MatchState, rng: Rng): DicePair {
  const rolls = balancedDiceWeights(m);
  const a = rng(), b = rng();
  if (rolls.every(r => r.weight === 1)) return [a, b];
  // Eight base-six digits give 1,679,616 possible samples, without reroll loops.
  let sample = (a - 1) * 6 + b - 1;
  let range = 36;
  for (let i = 0; i < 6; i++) { sample = sample * 6 + rng() - 1; range *= 6; }
  let target = sample / range * rolls.reduce((sum, r) => sum + r.weight, 0);
  for (const roll of rolls) {
    target -= roll.weight;
    if (target < 0) return roll.dice;
  }
  return rolls[rolls.length - 1].dice;
}
