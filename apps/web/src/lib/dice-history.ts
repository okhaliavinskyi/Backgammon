import { gamePath } from './paths';
import type { Color, MatchState, Rng } from '@nardy/core';

export interface DiceEntry {
  gameNo: number;
  seq: number;
  at: string;
  player: Color | null;
  dice: [number, number];
  kind: 'opening' | 'turn';
  accepted: boolean;
}
export interface DiceHistory {
  id: string;
  startedAt: string;
  finished: boolean;
  partial: boolean;
  entries: DiceEntry[];
}
const KEY = 'nardy.aiDiceHistory';
export function loadDiceHistories(): DiceHistory[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(h => h && typeof h.id === 'string' && typeof h.startedAt === 'string' && Array.isArray(h.entries)) : [];
  } catch { return []; }
}
export function saveDiceHistory(history: DiceHistory): void {
  try {
    const all = loadDiceHistories().filter(h => h.id !== history.id);
    localStorage.setItem(KEY, JSON.stringify([history, ...all].slice(0, 10)));
  } catch { /* A full or disabled browser store must not interrupt a turn. */ }
}
export function createDiceHistory(partial = false): DiceHistory {
  return { id: crypto.randomUUID(), startedAt: new Date().toISOString(), finished: false, partial, entries: [] };
}
/** Record selected turn dice, and every raw opening contest attempt. */
export function recordDice(operation: (rng: Rng) => MatchState, rng: Rng, history: DiceHistory, player: Color | null): MatchState {
  const draws: number[] = [];
  const match = operation(() => { const d = rng(); draws.push(d); return d; });
  if (player !== null && draws.length) draws.splice(0, draws.length, ...match.dice);
  const entries: DiceEntry[] = [];
  for (let i = 0; i < draws.length; i += 2) entries.push({
    gameNo: match.gameNo, seq: match.seq, at: new Date().toISOString(), player,
    dice: [draws[i], draws[i + 1]], kind: player === null ? 'opening' : 'turn',
    accepted: player !== null || (i === draws.length - 2 && draws[i] !== draws[i + 1]),
  });
  history.entries.push(...entries);
  history.finished = match.phase === 'matchover';
  if (entries.length) {
    // Best-effort diagnostic delivery; failure must never block gameplay.
    void fetch(gamePath('/api/ai/dice'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: history.id, entries }), keepalive: true }).catch(() => {});
  }
  return match;
}
export function diceStats(entries: DiceEntry[], player: Color) {
  const rolls = entries.filter(e => e.kind === 'turn' && e.accepted && e.player === player);
  const faces = [0, 0, 0, 0, 0, 0];
  let sum = 0, doubles = 0, movement = 0;
  for (const { dice: [a, b] } of rolls) {
    faces[a - 1]++; faces[b - 1]++; sum += a + b;
    if (a === b) doubles++;
    movement += a === b ? a * 4 : a + b;
  }
  return { count: rolls.length, doubles, average: rolls.length ? sum / rolls.length : null, movement, faces };
}
