/** Shared progression contract. Game rules remain in game.ts. */
export type CosmeticKind = 'avatar' | 'frame' | 'dice' | 'theme';
export interface Cosmetic { id: string; kind: CosmeticKind; price: number; ru: string; en: string; value: string }
export const COSMETICS: Cosmetic[] = [
  { id: 'fox', kind: 'avatar', price: 100, ru: 'Лис', en: 'Fox', value: '🦊' },
  { id: 'owl', kind: 'avatar', price: 100, ru: 'Сова', en: 'Owl', value: '🦉' },
  { id: 'cat', kind: 'avatar', price: 100, ru: 'Кот', en: 'Cat', value: '🐈' },
  { id: 'raven', kind: 'avatar', price: 100, ru: 'Ворон', en: 'Raven', value: '🐦‍⬛' },
  { id: 'copper', kind: 'frame', price: 200, ru: 'Медная рамка', en: 'Copper frame', value: '#cb8b59' },
  { id: 'silver', kind: 'frame', price: 200, ru: 'Серебряная рамка', en: 'Silver frame', value: '#a9b9ce' },
  { id: 'amber-dice', kind: 'dice', price: 300, ru: 'Янтарные кости', en: 'Amber dice', value: 'amber' },
  { id: 'jade-dice', kind: 'dice', price: 300, ru: 'Нефритовые кости', en: 'Jade dice', value: 'jade' },
  { id: 'amber-board', kind: 'theme', price: 700, ru: 'Янтарь', en: 'Amber', value: 'amber' },
  { id: 'slate-board', kind: 'theme', price: 700, ru: 'Сланец', en: 'Slate', value: 'slate' },
];
export const LEVEL_ITEMS: Cosmetic[] = [
  { id: 'level-5', kind: 'avatar', price: 0, ru: 'Лев · уровень 5', en: 'Lion · level 5', value: '🦁' },
  { id: 'level-10', kind: 'frame', price: 0, ru: 'Золото · уровень 10', en: 'Gold · level 10', value: '#e3bf56' },
  { id: 'level-20', kind: 'avatar', price: 0, ru: 'Дракон · уровень 20', en: 'Dragon · level 20', value: '🐉' },
  { id: 'level-30', kind: 'frame', price: 0, ru: 'Аметист · уровень 30', en: 'Amethyst · level 30', value: '#b995ef' },
];
export const ALL_COSMETICS = [...COSMETICS, ...LEVEL_ITEMS];
export const xpForLevel = (level: number) => 200 * (level - 1) + 25 * (level - 1) * (level - 2);
export function levelForXp(xp: number): number { return Math.floor((-175 + Math.sqrt(30625 + 100 * xp)) / 50) + 1; }
export interface ProgressStats { games: number; matches: number; wins: number; losses: number; qualified: number; qualifiedWins: number }
export interface ProgressReward { event: string; xp: number; coins: number; limited: boolean; qualified: boolean; at: number }
export interface ProgressProfile {
  xp: number; coins: number; owned: string[]; equipped: Partial<Record<CosmeticKind, string>>;
  stats: Record<'long' | 'short', ProgressStats>; badges: string[]; lastReward: ProgressReward | null;
}
export interface ProgressEvent {
  id: string; room: string; opponent: string; variant: 'long' | 'short'; won: boolean;
  qualified: boolean; matchWon: boolean | null; at: number;
}
export const newStats = (): ProgressStats => ({ games: 0, matches: 0, wins: 0, losses: 0, qualified: 0, qualifiedWins: 0 });
export const newProfile = (): ProgressProfile => ({ xp: 0, coins: 0, owned: [], equipped: {}, stats: { long: newStats(), short: newStats() }, badges: [], lastReward: null });
export const PROFILE_COOKIE = 'nardy_guest';
export function profileToken(cookie: string | null): string | null {
  const value = cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(PROFILE_COOKIE + '='))?.slice(PROFILE_COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
