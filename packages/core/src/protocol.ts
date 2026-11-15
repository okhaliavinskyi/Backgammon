import type { Color, Variant } from './board';
import type { MatchState } from './game';
import type { Step } from './moves';

export const MATCH_LENGTHS = [1, 3, 5, 7] as const;
export const MOVE_TIMERS = [0, 15, 30, 60, 90] as const; // seconds, 0 = off
export const BANKS = [0, 180, 300, 600, 1200] as const; // seconds, 0 = off
export const EMOJIS = ['👍', '😂', '😮', '😢', '😡', '🔥', '🎲', '🤝'] as const;
export const CHAT_MAX = 200;
export const NAME_MAX = 20;

export interface RoomSettings {
  variant: Variant;
  matchLength: number;
  moveTimer: number; // seconds
  bank: number; // seconds
  cube: boolean;
  isPublic: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  variant: 'long',
  matchLength: 3,
  moveTimer: 60,
  bank: 0,
  cube: true,
  isPublic: true,
};

export function sanitizeSettings(input: Partial<RoomSettings> | undefined): RoomSettings {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const pick = <T extends number>(v: unknown, allowed: readonly T[], def: T): T =>
    (allowed as readonly unknown[]).includes(v) ? (v as T) : def;
  return {
    variant: s.variant === 'short' ? 'short' : 'long',
    matchLength: pick(s.matchLength, MATCH_LENGTHS, 3),
    moveTimer: pick(s.moveTimer, MOVE_TIMERS, 60),
    bank: pick(s.bank, BANKS, 0),
    cube: s.variant === 'short' && s.cube !== false,
    isPublic: s.isPublic !== false,
  };
}

export function sanitizeName(name: unknown): string {
  const n = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NAME_MAX) : '';
  return n || 'Игрок';
}

export function sanitizeChat(text: unknown): string {
  return typeof text === 'string' ? text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX) : '';
}

export interface PlayerInfo {
  name: string;
  connected: boolean;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface Clocks {
  /** Remaining bank per player in ms (null when bank is off). Does not include the running turn. */
  bank: [number, number] | null;
  /** Server timestamp (ms) when the current turn's clock started, null if no clock runs. */
  turnStartedAt: number | null;
  moveTimerMs: number;
}

export interface RoomView {
  id: string;
  settings: RoomSettings;
  hasPassword: boolean;
  players: [PlayerInfo | null, PlayerInfo | null];
  status: RoomStatus;
  rematch: [boolean, boolean];
}

export interface LobbyEntry {
  id: string;
  host: string;
  settings: RoomSettings;
  hasPassword: boolean;
  createdAt: number;
}

export interface ChatLine {
  from: Color;
  text: string;
  at: number;
}

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string; password?: string }
  | { t: 'roll' }
  | { t: 'move'; steps: { from: number; die: number }[] }
  | { t: 'double' }
  | { t: 'take' }
  | { t: 'drop' }
  | { t: 'resign' }
  | { t: 'next' }
  | { t: 'rematch' }
  | { t: 'chat'; text: string }
  | { t: 'emoji'; e: string }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; you: Color; token: string }
  | { t: 'state'; room: RoomView; match: MatchState | null; clocks: Clocks; serverNow: number; chat?: ChatLine[] }
  | { t: 'moved'; by: Color; steps: Step[] }
  | { t: 'chat'; line: ChatLine }
  | { t: 'emoji'; from: Color; e: string }
  | { t: 'error'; code: string }
  | { t: 'pong'; serverNow: number };
