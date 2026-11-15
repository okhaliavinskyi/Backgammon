import {
  Action,
  AiLevel,
  Color,
  GameError,
  MatchSettings,
  MatchState,
  Step,
  applyAction,
  chooseTurn,
  newMatch,
  shouldDouble,
  shouldTake,
  type Rng,
} from '@nardy/core';
import { Controller, actor, initialGameStore, pushEmoji, useGame } from './store';
import { diceMs, moveMs, useSettings } from '../lib/settings';

const SAVE_KEY = 'nardy.aiGame';
const NEXT_DELAY = 6000;

const cryptoRng: Rng = () => {
  const b = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < 252) return 1 + (b[0] % 6);
  }
};

export interface LocalOptions {
  mode: 'ai' | 'local';
  settings: MatchSettings;
  level: AiLevel;
  names: [string, string];
  resume?: MatchState;
}

interface Saved {
  match: MatchState;
  level: AiLevel;
  names: [string, string];
}

export function loadSavedAiGame(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return s.match.phase === 'matchover' ? null : s;
  } catch {
    return null;
  }
}

export function clearSavedAiGame(): void {
  localStorage.removeItem(SAVE_KEY);
}

/** Runs the whole match in the browser: vs AI (seat 1) or hot-seat. */
export class LocalController implements Controller {
  private worker: Worker | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private reqId = 0;
  private disposed = false;

  constructor(private opts: LocalOptions) {
    const match = opts.resume ?? newMatch(opts.settings, cryptoRng);
    useGame.setState({
      ...initialGameStore,
      mode: opts.mode,
      match,
      controls: opts.mode === 'ai' ? [true, false] : [true, true],
      viewer: 0,
      players: [
        { name: opts.names[0], connected: true, disconnectedAt: null },
        { name: opts.names[1], connected: true, disconnectedAt: null, isAi: opts.mode === 'ai' },
      ],
      aiLevel: opts.mode === 'ai' ? opts.level : null,
      conn: 'open',
      controller: this,
    });
    if (opts.mode === 'ai') {
      try {
        this.worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
      } catch {
        this.worker = null;
      }
    }
    this.afterChange(match);
  }

  private get m(): MatchState {
    return useGame.getState().match!;
  }

  private dispatch(action: Action): void {
    if (this.disposed) return;
    try {
      const next = applyAction(this.m, action, cryptoRng);
      useGame.setState({ match: next, error: null });
      this.afterChange(next);
    } catch (e) {
      if (e instanceof GameError) useGame.setState({ error: e.code });
      else throw e;
    }
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private afterChange(m: MatchState): void {
    if (this.opts.mode === 'ai') {
      if (m.phase === 'matchover') clearSavedAiGame();
      else localStorage.setItem(SAVE_KEY, JSON.stringify({ match: m, level: this.opts.level, names: this.opts.names } satisfies Saved));
    }
    if (m.phase === 'gameover') {
      const at = Date.now() + NEXT_DELAY;
      useGame.setState({ clocks: { bank: null, turnStartedAt: null, moveTimerMs: 0, nextGameAt: at } });
      const seq = m.seq;
      this.later(() => {
        if (this.m.seq === seq) this.next();
      }, NEXT_DELAY);
      return;
    }
    useGame.setState({ clocks: null });
    if (this.opts.mode !== 'ai') return;
    const who = actor(m);
    if (who !== 1) return;
    const speed = useSettings.getState().speed;
    // Give the UI time to animate the previous action.
    const animDelay = m.event?.type === 'moved' ? m.event.steps.length * moveMs(speed) : 0;
    const think = Math.max(350, diceMs(speed) * 0.5) + animDelay;
    const level = this.opts.level;
    const seq = m.seq;
    if (m.phase === 'roll') {
      this.later(() => {
        if (this.m.seq !== seq) return;
        this.dispatch({ type: shouldDouble(this.m, 1, level) ? 'double' : 'roll', player: 1 });
      }, think);
    } else if (m.phase === 'cube') {
      this.later(() => {
        if (this.m.seq !== seq) return;
        this.dispatch({ type: shouldTake(this.m, 1, level) ? 'take' : 'drop', player: 1 });
      }, think + 400);
    } else if (m.phase === 'move') {
      const started = Date.now();
      const minDelay = diceMs(speed) + 250 + animDelay;
      useGame.setState({ aiThinking: true });
      this.computeMove(m, level).then((steps) => {
        if (this.disposed || this.m.seq !== seq) return;
        this.later(() => {
          useGame.setState({ aiThinking: false });
          this.dispatch({ type: 'move', player: 1, steps: steps.map((s) => ({ from: s.from, die: s.die })) });
        }, Math.max(0, minDelay - (Date.now() - started)));
      });
    }
  }

  private computeMove(m: MatchState, level: AiLevel): Promise<Step[]> {
    const w = this.worker;
    if (!w) return Promise.resolve(chooseTurn(m, level));
    const id = ++this.reqId;
    return new Promise((resolve) => {
      const onMsg = (e: MessageEvent<{ id: number; steps: Step[] }>) => {
        if (e.data.id !== id) return;
        w.removeEventListener('message', onMsg);
        resolve(e.data.steps);
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ id, match: m, level });
    });
  }

  private me(): Color {
    // Hot-seat: whoever must act; AI mode: always seat 0.
    if (this.opts.mode === 'ai') return 0;
    return actor(this.m) ?? this.m.turn;
  }

  roll() { this.dispatch({ type: 'roll', player: this.me() }); }
  move(steps: Step[]) { this.dispatch({ type: 'move', player: this.me(), steps: steps.map((s) => ({ from: s.from, die: s.die })) }); }
  double() { this.dispatch({ type: 'double', player: this.me() }); }
  take() { this.dispatch({ type: 'take', player: this.me() }); }
  drop() { this.dispatch({ type: 'drop', player: this.me() }); }
  resign() {
    const m = this.m;
    const p = this.opts.mode === 'ai' ? 0 : m.turn;
    this.dispatch({ type: 'resign', player: p });
  }
  next() {
    if (this.m.phase === 'gameover') this.dispatch({ type: 'next', player: 0 });
  }
  rematch() {
    if (this.m.phase !== 'matchover') return;
    const match = newMatch(this.opts.settings, cryptoRng);
    useGame.setState({ match });
    this.afterChange(match);
  }
  claim() {}
  chat() {}
  emoji(e: string) { pushEmoji(0, e); }
  dispose() {
    this.disposed = true;
    this.timers.forEach(clearTimeout);
    this.worker?.terminate();
  }
}
