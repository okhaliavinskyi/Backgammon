import { describe, expect, it } from 'vitest';
import {
  BAR,
  Board,
  OFF,
  TurnState,
  absoluteView,
  applyAction,
  chooseTurn,
  destinationsFrom,
  emptyBoard,
  expandDice,
  fromAbs,
  initialBoard,
  legalNextSteps,
  newMatch,
  pipCount,
  toAbs,
  toOther,
  validateTurn,
  winMultiplier,
  allTurns,
  checkerTotal,
  MatchState,
  Rng,
  Variant,
  Color,
  headLimitFor,
  shouldDouble,
  shouldTake,
  AiLevel,
} from '../src';

function ts(variant: Variant, board: Board, d1: number, d2: number, player: Color = 0, firstTurn = false): TurnState {
  const remaining = expandDice(d1, d2);
  return { variant, board, player, remaining, headMoved: 0, headLimit: headLimitFor(variant, remaining, firstTurn) };
}

function seq(...vals: number[]): Rng {
  let i = 0;
  return () => vals[i++ % vals.length];
}

describe('coordinates', () => {
  it('toAbs/fromAbs are inverse and toOther agrees with absolute positions', () => {
    for (const v of ['long', 'short'] as Variant[]) {
      for (let p = 0; p < 24; p++) {
        for (const c of [0, 1] as Color[]) expect(fromAbs(c, toAbs(c, p, v), v)).toBe(p);
        expect(toAbs(1, toOther(p, v), v)).toBe(toAbs(0, p, v));
        expect(toOther(toOther(p, v), v)).toBe(p);
      }
    }
  });
  it('long heads are in opposite corners, homes are distinct quarters', () => {
    expect(toAbs(0, 0, 'long')).toBe(23);
    expect(toAbs(1, 0, 'long')).toBe(11);
    const whiteHome = [18, 19, 20, 21, 22, 23].map((p) => toAbs(0, p, 'long'));
    const blackHome = [18, 19, 20, 21, 22, 23].map((p) => toAbs(1, p, 'long'));
    expect(whiteHome.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(blackHome.sort((a, b) => a - b)).toEqual([12, 13, 14, 15, 16, 17]);
  });
  it('short starting position matches the standard layout', () => {
    const v = absoluteView(initialBoard('short'), 'short');
    expect(v[23]).toBe(2); // white 24-point
    expect(v[12]).toBe(5);
    expect(v[7]).toBe(3);
    expect(v[5]).toBe(5);
    expect(v[0]).toBe(-2); // black on white's 1-point
    expect(v[11]).toBe(-5);
    expect(v[16]).toBe(-3);
    expect(v[18]).toBe(-5);
    expect(pipCount(initialBoard('short'), 0)).toBe(167);
    expect(pipCount(initialBoard('long'), 1)).toBe(360);
  });
});

describe('long nardy', () => {
  it('only one checker may leave the head per turn', () => {
    const b = initialBoard('long');
    const opts = allTurns(ts('long', b, 5, 2));
    for (const o of opts) expect(o.board.pts[0][0]).toBe(14);
    // 5+2 combined with one checker, or 5 then 2 — the only possibility is one checker to pos 7 (or 5 / 2 split impossible)
    expect(opts.map((o) => o.board.pts[0].findIndex((n, i) => i > 0 && n > 0))).toEqual([7]);
  });

  it('first throw 6-6 allows two checkers from the head (blocked by the opponent head after one step each)', () => {
    const b = initialBoard('long');
    const opts = allTurns(ts('long', b, 6, 6, 0, true));
    expect(opts.length).toBe(1);
    expect(opts[0].board.pts[0][0]).toBe(13);
    expect(opts[0].board.pts[0][6]).toBe(2);
    expect(opts[0].steps.length).toBe(2);
  });

  it('6-6 on a later turn allows only one checker from the head', () => {
    const b = initialBoard('long');
    const opts = allTurns(ts('long', b, 6, 6, 0, false));
    for (const o of opts) expect(o.board.pts[0][0]).toBe(14);
  });

  it('cannot land on a point occupied by a single opponent checker', () => {
    const b = emptyBoard();
    b.pts[0][0] = 14;
    b.pts[0][3] = 1;
    // opponent checker at white pos 5 → black pos (5+12)%24 = 17
    b.pts[1][17] = 1;
    b.pts[1][0] = 14;
    const steps = legalNextSteps(ts('long', b, 2, 1));
    expect(steps.find((s) => s.from === 3 && s.die === 2)).toBeUndefined();
  });

  it('forbids a 6-prime with no opponent checker ahead of it', () => {
    const b = emptyBoard();
    // White holds pos 1..5, needs pos 6 to complete a 6-prime.
    for (let p = 1; p <= 5; p++) b.pts[0][p] = 2;
    b.pts[0][0] = 4;
    b.pts[0][9] = 1;
    // All black checkers on their head (black pos 0 = white pos 12): behind the block.
    b.pts[1][0] = 15;
    const t = ts('long', b, 3, 3);
    t.headMoved = 1; // head already used
    expect(checkerTotal(b, 0)).toBe(15);
    const s = legalNextSteps(t);
    // Moving 3 → 6 would build 1..6 prime; it must be absent.
    expect(s.find((x) => x.from === 3 && x.to === 6)).toBeUndefined();
  });

  it('allows the 6-prime when an opponent checker is ahead', () => {
    const b = emptyBoard();
    for (let p = 1; p <= 5; p++) b.pts[0][p] = 2;
    b.pts[0][0] = 4;
    b.pts[0][9] = 1;
    b.pts[1][0] = 14;
    // Black checker at black pos 20 (white pos 8) is ahead of the block (block is black pos 13..18).
    b.pts[1][20] = 1;
    const t = ts('long', b, 3, 3);
    t.headMoved = 1;
    const s = legalNextSteps(t);
    expect(s.find((x) => x.from === 3 && x.to === 6)).toBeDefined();
  });
});

describe('short nardy (backgammon)', () => {
  it('hits a blot and sends it to the bar', () => {
    const b = emptyBoard();
    b.pts[0][10] = 15;
    // black blot at white pos 13 → black pos 10
    b.pts[1][10] = 1;
    b.pts[1][23] = 14;
    const res = validateTurn(ts('short', b, 3, 1), [{ from: 10, die: 3 }, { from: 13, die: 1 }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.steps[0].hit).toBe(true);
      expect(res.end.board.bar[1]).toBe(1);
    }
  });

  it('must enter from the bar first, blocked entry forfeits', () => {
    const b = emptyBoard();
    b.bar[0] = 1;
    b.pts[0][10] = 14;
    // Black closes white entry points pos 0..5 → black pos 18..23
    for (let q = 18; q < 24; q++) b.pts[1][q] = 2;
    b.pts[1][5] = 3;
    expect(legalNextSteps(ts('short', b, 3, 5))).toEqual([]);
    b.pts[1][20] = 0; // opens white pos 3
    b.pts[1][5] += 2;
    const s = legalNextSteps(ts('short', b, 4, 5));
    expect(s.every((x) => x.from === BAR)).toBe(true);
    expect(s.map((x) => x.to)).toEqual([3]);
  });

  it('must play both dice when possible', () => {
    const b = emptyBoard();
    b.pts[0][0] = 1;
    b.pts[0][10] = 14;
    // Block white pos 6 (black pos 17) so 0→6 single-step is impossible, but 0→1→6? die 1 then 5: pos1 to pos 6 blocked too.
    b.pts[1][17] = 2;
    b.pts[1][23] = 13;
    const opts = allTurns(ts('short', b, 6, 1));
    for (const o of opts) expect(o.steps.length).toBe(2);
  });

  it('plays the larger die when only one can be played', () => {
    const b = emptyBoard();
    b.pts[0][17] = 1;
    b.pts[0][18] = 14;
    b.pts[1][toOther(19, 'short')] = 2; // blocks 17+2
    b.pts[1][toOther(20, 'short')] = 2; // blocks 18+2
    b.pts[1][toOther(13, 'short')] = 11; // far behind, irrelevant
    expect(checkerTotal(b, 1)).toBe(15);
    // 6: 17→23 playable; afterwards 2 can't be played (18→20 blocked, 23→off needs no checker behind).
    // 2 first: 17→19 blocked, 18→20 blocked. So only one die — must be the 6.
    const steps = legalNextSteps(ts('short', b, 6, 2));
    expect(steps.map((s) => [s.from, s.die])).toEqual([[17, 6]]);
  });

  it('bear-off with a higher die only from the farthest checker', () => {
    const b = emptyBoard();
    b.pts[0][20] = 1; // 4-point
    b.pts[0][22] = 14; // 2-point
    b.pts[1][0] = 15;
    const steps = legalNextSteps(ts('short', b, 6, 5));
    expect(steps.some((s) => s.from === 20 && s.to === OFF)).toBe(true);
    expect(steps.some((s) => s.from === 22 && s.to === OFF)).toBe(false);
  });

  it('cannot bear off with checkers outside home', () => {
    const b = emptyBoard();
    b.pts[0][17] = 1;
    b.pts[0][23] = 14;
    b.pts[1][0] = 15;
    const steps = legalNextSteps(ts('short', b, 1, 3));
    expect(steps.some((s) => s.to === OFF)).toBe(false);
  });

  it('gammon and backgammon multipliers', () => {
    const b = emptyBoard();
    b.off[0] = 15;
    b.pts[1][10] = 15;
    expect(winMultiplier(b, 'short', 0)).toBe(2);
    b.pts[1][10] = 14;
    b.pts[1][2] = 1; // in white's home
    expect(winMultiplier(b, 'short', 0)).toBe(3);
    b.off[1] = 1;
    b.pts[1][2] = 0;
    expect(winMultiplier(b, 'short', 0)).toBe(1);
    expect(winMultiplier({ ...b, off: [15, 0] }, 'long', 0)).toBe(2);
  });
});

describe('UI helpers', () => {
  it('combined destinations include sum of dice with one checker', () => {
    const b = initialBoard('short');
    const d = destinationsFrom(ts('short', b, 3, 1), 0);
    const tos = d.map((x) => x.to).sort((a, b) => a - b);
    expect(tos).toContain(4); // 24-point to 20-point via 3+1
    const four = d.find((x) => x.to === 4)!;
    expect(four.steps.length).toBe(2);
  });
});

describe('match flow', () => {
  it('opening roll in short plays the opening dice immediately', () => {
    const m = newMatch({ variant: 'short', matchLength: 1, cube: true }, seq(3, 1));
    expect(m.phase).toBe('move');
    expect(m.turn).toBe(0);
    expect(m.remaining.sort()).toEqual([1, 3]);
  });

  it('long: opening winner then rolls', () => {
    const m = newMatch({ variant: 'long', matchLength: 1, cube: false }, seq(2, 5));
    expect(m.phase).toBe('roll');
    expect(m.turn).toBe(1);
  });

  it('doubling: take doubles the cube and transfers ownership, drop ends the game', () => {
    let m = newMatch({ variant: 'short', matchLength: 5, cube: true }, seq(3, 1));
    m = applyAction(m, { type: 'move', player: 0, steps: [{ from: 16, die: 3 }, { from: 18, die: 1 }] });
    expect(m.turn).toBe(1);
    m = applyAction(m, { type: 'double', player: 1 });
    expect(m.phase).toBe('cube');
    const taken = applyAction(m, { type: 'take', player: 0 });
    expect(taken.cube).toEqual({ value: 2, owner: 0 });
    expect(() => applyAction(taken, { type: 'double', player: 1 })).toThrow();
    const dropped = applyAction(m, { type: 'drop', player: 0 });
    expect(dropped.phase).toBe('gameover');
    expect(dropped.score).toEqual([0, 1]);
  });

  it('rejects illegal moves and moves out of turn', () => {
    const m = newMatch({ variant: 'short', matchLength: 1, cube: false }, seq(3, 1));
    expect(() => applyAction(m, { type: 'move', player: 1, steps: [] })).toThrow();
    expect(() => applyAction(m, { type: 'move', player: 0, steps: [{ from: 0, die: 6 }] })).toThrow();
    expect(() => applyAction(m, { type: 'move', player: 0, steps: [{ from: 16, die: 3 }] })).toThrow(/incomplete/);
  });

  it('crawford game disables the cube', () => {
    let m = newMatch({ variant: 'short', matchLength: 3, cube: true }, seq(3, 1));
    m = applyAction(m, { type: 'resign', player: 1 }); // gammon: white gets 2 = length - 1
    expect(m.score).toEqual([2, 0]);
    expect(m.phase).toBe('gameover');
    m = applyAction(m, { type: 'next', player: 0 }, seq(4, 2));
    expect(m.crawford).toBe(true);
    expect(() => applyAction(m, { type: 'double', player: m.turn })).toThrow();
  });
});

describe('AI self-play fuzz', () => {
  const play = (variant: Variant, a: AiLevel, b: AiLevel, seed: number) => {
    let s = seed;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x80000000;
    };
    const rng: Rng = () => 1 + Math.floor(rnd() * 6);
    let m: MatchState = newMatch({ variant, matchLength: 1, cube: variant === 'short' }, rng);
    let guard = 0;
    while (m.phase !== 'matchover' && guard++ < 2000) {
      const lvl = m.turn === 0 ? a : b;
      if (m.phase === 'roll') {
        if (shouldDouble(m, m.turn, lvl)) m = applyAction(m, { type: 'double', player: m.turn }, rng);
        else m = applyAction(m, { type: 'roll', player: m.turn }, rng);
      } else if (m.phase === 'cube') {
        const responder = m.turn === 0 ? 1 : 0;
        m = applyAction(m, { type: shouldTake(m, responder, lvl) ? 'take' : 'drop', player: responder }, rng);
      } else if (m.phase === 'move') {
        const steps = chooseTurn(m, lvl, rnd);
        m = applyAction(m, { type: 'move', player: m.turn, steps }, rng);
      }
      expect(checkerTotal(m.board, 0)).toBe(15);
      expect(checkerTotal(m.board, 1)).toBe(15);
    }
    expect(m.phase).toBe('matchover');
    return m.matchWinner;
  };

  it('plays 25 full long games and 25 short games without errors', () => {
    for (let i = 0; i < 25; i++) play('long', 'amateur', 'beginner', 1000 + i);
    for (let i = 0; i < 25; i++) play('short', 'amateur', 'beginner', 2000 + i);
  }, 120_000);

  it('master beats beginner most of the time (long)', () => {
    let wins = 0;
    const N = 16;
    for (let i = 0; i < N; i++) if (play('long', i % 2 ? 'master' : 'beginner', i % 2 ? 'beginner' : 'master', 77 + i) === (i % 2 ? 0 : 1)) wins++;
    expect(wins / N).toBeGreaterThan(0.6);
  }, 240_000);

  it('master beats beginner most of the time (short)', () => {
    let wins = 0;
    const N = 16;
    for (let i = 0; i < N; i++) if (play('short', i % 2 ? 'master' : 'beginner', i % 2 ? 'beginner' : 'master', 177 + i) === (i % 2 ? 0 : 1)) wins++;
    expect(wins / N).toBeGreaterThan(0.6);
  }, 240_000);
});
