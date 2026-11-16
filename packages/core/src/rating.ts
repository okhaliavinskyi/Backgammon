import type { Variant } from './board';
export interface Rating { elo: number; matches: number; wins: number; losses: number; best: number | null }
export const initialRating = (): Rating => ({ elo: 1000, matches: 0, wins: 0, losses: 0, best: null });
export const initialRatings = (): Record<Variant, Rating> => ({ long: initialRating(), short: initialRating() });
export const RANKS = [
  { min: -Infinity, ru: 'Бронза', en: 'Bronze' }, { min: 900, ru: 'Серебро', en: 'Silver' },
  { min: 1100, ru: 'Золото', en: 'Gold' }, { min: 1300, ru: 'Платина', en: 'Platinum' },
  { min: 1500, ru: 'Алмаз', en: 'Diamond' }, { min: 1700, ru: 'Мастер', en: 'Master' },
];
export const rankFor = (elo: number) => [...RANKS].reverse().find(r => elo >= r.min)!;
export function ratingLabel(r: Rating, ru: boolean): string {
  return r.matches < 10 ? `${ru ? 'Калибровка' : 'Placement'} ${r.matches}/10` : `${rankFor(r.elo)[ru ? 'ru' : 'en']} · ${r.elo}`;
}
export function eloChange(own: Rating, opponent: Rating, won: boolean): number {
  const value = (own.matches < 10 ? 64 : 32) * ((won ? 1 : 0) - 1 / (1 + 10 ** ((opponent.elo - own.elo) / 400)));
  return Math.sign(value) * Math.round(Math.abs(value));
}
export function updatedRating(own: Rating, opponent: Rating, won: boolean): Rating {
  const elo = own.elo + eloChange(own, opponent, won), matches = own.matches + 1;
  return { elo, matches, wins: own.wins + Number(won), losses: own.losses + Number(!won), best: matches >= 10 ? Math.max(own.best ?? -Infinity, elo) : null };
}
/** Both players accept the larger waiting range; after two minutes any Elo is eligible. */
export function matchingRange(waitMs: number): number {
  return waitMs >= 120000 ? Infinity : 100 + Math.floor(Math.max(0, waitMs) / 15000) * 100;
}
export interface RatingEvent { id: string; room: string; variant: Variant; own: Rating; opponent: Rating; won: boolean; at: number }
export interface RankedView {
  ratings: [Rating, Rating]; changes?: [number, number]; settled: boolean; cancelled: boolean; joinBy: number;
}
export interface RankedTicket { id: string; key: string; room: string | null; expires: number }
export type SearchStatus = { status: 'idle' | 'busy' | 'cancelled' } | { status: 'searching'; since: number } | { status: 'matched'; room: string };
