import { describe, expect, it } from 'vitest';
import { applyAction, balancedDiceWeights, balancedRoll, catchupStrength, emptyBoard, isPureRace, newMatch, recordDiceTurnResult } from '../src';

const start = () => { let i = 0; return newMatch({ variant: 'long', matchLength: 5, cube: false }, () => [6, 1][i++]); };
const weight = (m: ReturnType<typeof start>, a: number, b: number) => balancedDiceWeights(m).find(r => r.dice[0] === a && r.dice[1] === b)!.weight;

describe('balanced dice shared by all game modes', () => {
  it('preserves normal weights without history and applies unordered per-seat repeat penalties', () => {
    const m = start();
    expect(balancedDiceWeights(m).every(r => r.weight === 1)).toBe(true);
    m.recentDice = [[[2, 1]], [[6, 6]]];
    expect(weight(m, 1, 2)).toBe(0.65);
    expect(weight(m, 6, 6)).toBe(1);
    m.recentDice[0] = [[1, 2], [2, 1]];
    expect(weight(m, 2, 1)).toBe(0.25);
    m.recentDice[0] = [[1, 2], [3, 4]];
    expect(weight(m, 1, 2)).toBe(0.85);
  });

  it('persists a bounded history, counts blocked rolls, migrates old saves and resets next game', () => {
    const m = start();
    delete m.recentDice;
    m.board.pts[1].fill(0); m.board.pts[1][13] = 7; m.board.pts[1][14] = 8;
    const rolled = applyAction(m, { type: 'roll', player: 0, dice: [1, 2] });
    expect(rolled.event?.type).toBe('nomoves');
    expect(JSON.parse(JSON.stringify(rolled)).recentDice).toEqual([[[1, 2]], []]);
    expect(m.recentDice).toBeUndefined();
    const ended = applyAction(rolled, { type: 'resign', player: 1 });
    const next = applyAction(ended, { type: 'next', player: 0 }, (() => { let i = 0; return () => [6, 1][i++]; })());
    expect(next.recentDice).toEqual([[], []]);
  });

  it('helps only the trailing seat in a separated race, within the configured weight cap', () => {
    const m = start(); m.board = emptyBoard();
    m.board.pts[0][18] = 15; m.board.pts[1][22] = 15;
    expect(isPureRace(m)).toBe(true);
    expect(catchupStrength(m)).toBe(1);
    expect(weight(m, 6, 6)).toBeCloseTo(1.2);
    expect(weight(m, 1, 2)).toBeLessThan(weight(m, 6, 6));
    expect(balancedDiceWeights(m).every(r => r.weight >= 0.8 && r.weight <= 1.2)).toBe(true);
    m.turn = 1;
    expect(catchupStrength(m)).toBe(0);
    m.turn = 0; m.board.pts[1][22]--; m.board.pts[1][0]++;
    expect(isPureRace(m)).toBe(false);
    expect(catchupStrength(m)).toBe(0);
    m.settings.variant = 'short';
    expect(isPureRace(m)).toBe(false);
  });

  it('records partial turns and partially usable doubles as blocked', () => {
    for (const dice of [[1, 2], [1, 1]] as [number, number][]) {
      const m = start();
      m.board.pts[1].fill(0); m.board.pts[1][14] = 7; m.board.pts[1][15] = 8;
      const rolled = applyAction(m, { type: 'roll', player: 0, dice });
      expect(rolled.blockedTurns).toEqual([[], []]);
      const moved = applyAction(rolled, { type: 'move', player: 0, steps: [{ from: 0, die: 1 }] });
      expect(moved.blockedTurns).toEqual([[true], []]);
      expect(moved.catchupCooldown).toEqual([0, 0]);
      expect(rolled.blockedTurns).toEqual([[], []]);
    }
  });

  it('records an entirely blocked roll once, without waiting for a move action', () => {
    const m = start();
    m.blockedTurns = [[true], []];
    m.board.pts[1].fill(0); m.board.pts[1][13] = 7; m.board.pts[1][14] = 8;
    const blocked = applyAction(m, { type: 'roll', player: 0, dice: [1, 2] });
    expect(blocked.event?.type).toBe('nomoves');
    expect(blocked.blockedTurns).toEqual([[true, true], []]);
    expect(blocked.catchupCooldown).toEqual([5, 0]);
  });

  it('suppresses help for exactly five subsequent own turns, preserving repeat reduction', () => {
    let m = start(); m.board = emptyBoard();
    m.board.pts[0][18] = 15; m.board.pts[1][22] = 15;
    recordDiceTurnResult(m, 0, true);
    recordDiceTurnResult(m, 0, false);
    recordDiceTurnResult(m, 0, true);
    m.recentDice = [[[1, 2], [2, 1]], []];
    for (let remaining = 5; remaining > 0; remaining--) {
      expect(m.catchupCooldown).toEqual([remaining, 0]);
      expect(catchupStrength(m)).toBe(0);
      expect(weight(m, 6, 6)).toBe(1);
      expect(weight(m, 1, 2)).toBe(0.25);
      recordDiceTurnResult(m, 1, false);
      expect(m.catchupCooldown![0]).toBe(remaining);
      m = JSON.parse(JSON.stringify(m));
      recordDiceTurnResult(m, 0, false);
    }
    expect(m.catchupCooldown![0]).toBe(0);
    expect(catchupStrength(m)).toBe(1);
    expect(weight(m, 6, 6)).toBeCloseTo(1.2);
    expect(m.blockedTurns![0]).toEqual([false, false, false, false, false]);
  });

  it('counts only the last five own turns and refreshes only on a new qualifying block', () => {
    const m = start();
    delete m.blockedTurns; delete m.catchupCooldown;
    recordDiceTurnResult(m, 0, true);
    for (let i = 0; i < 4; i++) recordDiceTurnResult(m, 0, false);
    recordDiceTurnResult(m, 0, true);
    expect(m.catchupCooldown![0]).toBe(0); // First block has left the five-turn window.
    recordDiceTurnResult(m, 0, true);
    expect(m.catchupCooldown![0]).toBe(5);
    recordDiceTurnResult(m, 0, false);
    expect(m.catchupCooldown![0]).toBe(4);
    recordDiceTurnResult(m, 0, true);
    expect(m.catchupCooldown![0]).toBe(5);
    const ended = applyAction(m, { type: 'resign', player: 1 });
    let i = 0;
    const next = applyAction(ended, { type: 'next', player: 0 }, () => [6, 1][i++]);
    expect(next.blockedTurns).toEqual([[], []]);
    expect(next.catchupCooldown).toEqual([0, 0]);
  });

  it('samples the intended weights and keeps every pair possible', () => {
    const m = start(); m.recentDice = [[[1, 2], [2, 1]], []];
    let seed = 42;
    const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 1 + Math.floor(seed / 2 ** 32 * 6); };
    let repeats = 0, doubles = 0;
    const seen = new Set<string>();
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const d = balancedRoll(m, rng); seen.add(d.join(':'));
      if ([...d].sort().join(':') === '1:2') repeats++;
      if (d[0] === d[1]) doubles++;
    }
    expect(seen.size).toBe(36);
    expect(repeats / n).toBeCloseTo(0.5 / 34.5, 2);
    expect(doubles / n).toBeCloseTo(6 / 34.5, 2);
  });
});
