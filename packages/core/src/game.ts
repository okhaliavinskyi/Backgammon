import { Board, Color, Variant, initialBoard, other, checkerTotal, HOME_START } from './board';
import { Step, TurnState, expandDice, headLimitFor, legalNextSteps, validateTurn } from './moves';

export type Rng = () => number; // returns an integer die value 1..6

export const mathRng: Rng = () => 1 + Math.floor(Math.random() * 6);

export interface MatchSettings {
  variant: Variant;
  matchLength: number; // points to win the match
  cube: boolean; // doubling cube (short only)
}

export type Phase = 'roll' | 'move' | 'cube' | 'gameover' | 'matchover';

export type ResultKind = 'normal' | 'resign' | 'drop' | 'timeout';

export interface GameResult {
  winner: Color;
  points: number;
  /** 1 = single (ойн), 2 = mars / gammon, 3 = backgammon */
  multiplier: number;
  cube: number;
  kind: ResultKind;
}

export interface MatchState {
  settings: MatchSettings;
  score: [number, number];
  gameNo: number;
  crawfordUsed: boolean;
  crawford: boolean;
  board: Board;
  turn: Color;
  phase: Phase;
  dice: number[]; // last rolled pair (empty before the first roll of a turn)
  remaining: number[];
  headMoved: number;
  headLimit: number;
  turnsTaken: [number, number];
  cube: { value: number; owner: Color | null };
  cubeOfferedBy: Color | null;
  /** Opening roll (one die each) that decided who starts this game. */
  opening: [number, number] | null;
  result: GameResult | null;
  matchWinner: Color | null;
  /** Monotonic counter — increments on every applied action. */
  seq: number;
  /** Last notable event for UIs (no legal moves, etc.). */
  event: GameEvent | null;
}

export type GameEvent =
  | { type: 'nomoves'; player: Color; dice: number[] }
  | { type: 'moved'; player: Color; steps: Step[] }
  | { type: 'rolled'; player: Color; dice: number[] }
  | { type: 'doubled'; player: Color }
  | { type: 'taken'; player: Color }
  | { type: 'opening'; dice: [number, number] }
  | { type: 'gameover'; result: GameResult };

export type Action =
  | { type: 'roll'; player: Color; dice?: [number, number] }
  | { type: 'move'; player: Color; steps: { from: number; die: number }[] }
  | { type: 'double'; player: Color }
  | { type: 'take'; player: Color }
  | { type: 'drop'; player: Color }
  | { type: 'resign'; player: Color }
  | { type: 'timeout'; player: Color }
  | { type: 'next'; player: Color };

export class GameError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function openingRoll(rng: Rng): [number, number] {
  for (;;) {
    const a = rng();
    const b = rng();
    if (a !== b) return [a, b];
  }
}

function startGame(m: MatchState, rng: Rng): void {
  const { variant } = m.settings;
  m.board = initialBoard(variant);
  m.turnsTaken = [0, 0];
  m.cube = { value: 1, owner: null };
  m.cubeOfferedBy = null;
  m.result = null;
  m.dice = [];
  m.remaining = [];
  m.headMoved = 0;
  m.headLimit = 1;
  const op = openingRoll(rng);
  m.opening = op;
  m.turn = op[0] > op[1] ? 0 : 1;
  m.event = { type: 'opening', dice: op };
  if (variant === 'short') {
    beginMove(m, op[0], op[1]);
  } else {
    m.phase = 'roll';
  }
}

export function newMatch(settings: MatchSettings, rng: Rng = mathRng): MatchState {
  const m: MatchState = {
    settings: { ...settings, cube: settings.variant === 'short' && settings.cube },
    score: [0, 0],
    gameNo: 1,
    crawfordUsed: false,
    crawford: false,
    board: initialBoard(settings.variant),
    turn: 0,
    phase: 'roll',
    dice: [],
    remaining: [],
    headMoved: 0,
    headLimit: 1,
    turnsTaken: [0, 0],
    cube: { value: 1, owner: null },
    cubeOfferedBy: null,
    opening: null,
    result: null,
    matchWinner: null,
    seq: 0,
    event: null,
  };
  startGame(m, rng);
  return m;
}

export function turnState(m: MatchState): TurnState {
  return {
    variant: m.settings.variant,
    board: m.board,
    player: m.turn,
    remaining: m.remaining,
    headMoved: m.headMoved,
    headLimit: m.headLimit,
  };
}

function beginMove(m: MatchState, d1: number, d2: number): void {
  const dice = expandDice(d1, d2);
  m.dice = [d1, d2];
  m.remaining = dice;
  m.headMoved = 0;
  m.headLimit = headLimitFor(m.settings.variant, dice, m.turnsTaken[m.turn] === 0);
  m.turnsTaken[m.turn]++;
  m.phase = 'move';
  if (legalNextSteps(turnState(m)).length === 0) {
    m.event = { type: 'nomoves', player: m.turn, dice: [d1, d2] };
    passTurn(m);
  }
}

function passTurn(m: MatchState): void {
  m.turn = other(m.turn);
  m.phase = 'roll';
  m.remaining = [];
  m.headMoved = 0;
}

/** Points multiplier if `winner` won right now (mars / gammon / backgammon). */
export function winMultiplier(board: Board, variant: Variant, winner: Color): number {
  const loser = other(winner);
  if (board.off[loser] > 0) return 1;
  if (variant === 'long') return 2;
  if (board.bar[loser] > 0) return 3;
  // Loser checker in winner's home board = loser's path positions 0..5 in backgammon.
  for (let p = 0; p < 24 - HOME_START; p++) if (board.pts[loser][p] > 0) return 3;
  return 2;
}

export function canDouble(m: MatchState, player: Color): boolean {
  return (
    m.settings.cube &&
    m.phase === 'roll' &&
    m.turn === player &&
    !m.crawford &&
    (m.cube.owner === null || m.cube.owner === player) &&
    m.cube.value < 64 &&
    m.score[player] < m.settings.matchLength
  );
}

function settle(m: MatchState, winner: Color, multiplier: number, cubeValue: number, kind: ResultKind): void {
  const points = multiplier * cubeValue;
  const result: GameResult = { winner, points, multiplier, cube: cubeValue, kind };
  m.result = result;
  m.score[winner] += points;
  m.event = { type: 'gameover', result };
  m.remaining = [];
  if (kind === 'timeout' || m.score[winner] >= m.settings.matchLength) {
    if (kind === 'timeout') m.score[winner] = Math.max(m.score[winner], m.settings.matchLength);
    m.phase = 'matchover';
    m.matchWinner = winner;
  } else {
    m.phase = 'gameover';
  }
}

/** Pure reducer: returns a new state or throws GameError. */
export function applyAction(state: MatchState, action: Action, rng: Rng = mathRng): MatchState {
  const m: MatchState = JSON.parse(JSON.stringify(state));
  const p = action.player;
  switch (action.type) {
    case 'roll': {
      if (m.phase !== 'roll' || m.turn !== p) throw new GameError('not_your_roll');
      const [d1, d2] = action.dice ?? [rng(), rng()];
      m.event = { type: 'rolled', player: p, dice: [d1, d2] };
      beginMove(m, d1, d2);
      break;
    }
    case 'move': {
      if (m.phase !== 'move' || m.turn !== p) throw new GameError('not_your_move');
      const res = validateTurn(turnState(m), action.steps);
      if (!res.ok) throw new GameError(res.error);
      m.board = res.end.board;
      m.event = { type: 'moved', player: p, steps: res.steps };
      if (m.board.off[p] === 15) {
        settle(m, p, winMultiplier(m.board, m.settings.variant, p), m.cube.value, 'normal');
      } else {
        passTurn(m);
      }
      break;
    }
    case 'double': {
      if (!canDouble(m, p)) throw new GameError('cannot_double');
      m.phase = 'cube';
      m.cubeOfferedBy = p;
      m.event = { type: 'doubled', player: p };
      break;
    }
    case 'take': {
      if (m.phase !== 'cube' || m.cubeOfferedBy !== other(p)) throw new GameError('no_offer');
      m.cube = { value: m.cube.value * 2, owner: p };
      m.cubeOfferedBy = null;
      m.phase = 'roll';
      m.event = { type: 'taken', player: p };
      break;
    }
    case 'drop': {
      if (m.phase !== 'cube' || m.cubeOfferedBy !== other(p)) throw new GameError('no_offer');
      m.cubeOfferedBy = null;
      settle(m, other(p), 1, m.cube.value, 'drop');
      break;
    }
    case 'resign': {
      if (m.phase === 'gameover' || m.phase === 'matchover') throw new GameError('game_over');
      const w = other(p);
      // Resigning concedes mars/gammon by position, but never a backgammon.
      settle(m, w, Math.min(2, winMultiplier(m.board, m.settings.variant, w)), m.cube.value, 'resign');
      break;
    }
    case 'timeout': {
      if (m.phase === 'matchover') throw new GameError('game_over');
      settle(m, other(p), 1, m.cube.value, 'timeout');
      break;
    }
    case 'next': {
      if (m.phase !== 'gameover') throw new GameError('not_over');
      const length = m.settings.matchLength;
      const reachedCrawford = !m.crawfordUsed && length > 1 && (m.score[0] === length - 1 || m.score[1] === length - 1);
      m.crawford = reachedCrawford;
      if (reachedCrawford) m.crawfordUsed = true;
      m.gameNo++;
      startGame(m, rng);
      break;
    }
    default:
      throw new GameError('unknown_action');
  }
  m.seq++;
  // Invariant guard — should never trigger.
  if (checkerTotal(m.board, 0) !== 15 || checkerTotal(m.board, 1) !== 15) throw new GameError('invariant');
  return m;
}
