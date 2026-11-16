import { create } from 'zustand';
import type { AiLevel, ChatLine, Clocks, Color, MatchState, RoomView, Step } from '@nardy/core';

export type Mode = 'ai' | 'local' | 'online';
export type Conn = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface PlayerSlot {
  cosmetics?: Partial<Record<import('@nardy/core').CosmeticKind, string>>;
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
  isAi?: boolean;
}

export interface Controller {
  roll(): void;
  move(steps: Step[]): void;
  double(): void;
  take(): void;
  drop(): void;
  resign(): void;
  next(): void;
  rematch(): void;
  claim(): void;
  chat(text: string): void;
  emoji(e: string): void;
  dispose(): void;
}

export interface FloatingEmoji {
  id: number;
  from: Color;
  e: string;
}

export interface GameStore {
  mode: Mode;
  match: MatchState | null;
  /** Which seats this device may play for. */
  controls: [boolean, boolean];
  /** Board orientation: whose home is bottom-right. */
  viewer: Color;
  players: [PlayerSlot | null, PlayerSlot | null];
  room: RoomView | null;
  clocks: Clocks | null;
  /** serverNow - Date.now() */
  offset: number;
  chat: ChatLine[];
  emojis: FloatingEmoji[];
  conn: Conn;
  error: string | null;
  aiThinking: boolean;
  aiLevel: AiLevel | null;
  controller: Controller | null;
}

export const initialGameStore: Omit<GameStore, 'controller'> = {
  mode: 'ai',
  match: null,
  controls: [true, false],
  viewer: 0,
  players: [null, null],
  room: null,
  clocks: null,
  offset: 0,
  chat: [],
  emojis: [],
  conn: 'open',
  error: null,
  aiThinking: false,
  aiLevel: null,
};

export const useGame = create<GameStore>()(() => ({ ...initialGameStore, controller: null }));

let emojiId = 1;
export function pushEmoji(from: Color, e: string): void {
  const id = emojiId++;
  useGame.setState((s) => ({ emojis: [...s.emojis, { id, from, e }] }));
  setTimeout(() => useGame.setState((s) => ({ emojis: s.emojis.filter((x) => x.id !== id) })), 2600);
}

/** The seat that is expected to act now. */
export function actor(m: MatchState | null): Color | null {
  if (!m) return null;
  if (m.phase === 'roll' || m.phase === 'move') return m.turn;
  if (m.phase === 'cube') return m.turn === 0 ? 1 : 0;
  return null;
}
