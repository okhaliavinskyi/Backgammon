import { describe, expect, it } from 'vitest';
import { eloChange, initialRating, matchingRange, rankFor, updatedRating } from '../src/rating';
describe('ranked rating policy', () => {
  it('uses independent K for placement, symmetric pre-match snapshots, and half-away rounding', () => {
    const a = initialRating(), veteran = { ...initialRating(), matches: 10 };
    expect(eloChange(a, a, true)).toBe(32);
    expect(eloChange(a, a, false)).toBe(-32);
    expect(eloChange(veteran, veteran, true)).toBe(16);
    expect(eloChange(veteran, veteran, false)).toBe(-16);
    expect(eloChange(a, veteran, true) + eloChange(veteran, a, false)).toBe(16);
    expect(eloChange(a, { ...a, elo: 1400 }, true)).toBeGreaterThan(32);
    expect(eloChange(a, { ...a, elo: 600 }, true)).toBeLessThan(32);
  });
  it('calibrates ten times then records best rating without clamping or resets', () => {
    const ninth = { ...initialRating(), matches: 9, elo: 900 };
    const placed = updatedRating(ninth, ninth, true);
    expect(placed.matches).toBe(10); expect(placed.elo).toBe(932); expect(placed.best).toBe(932);
    const lost = updatedRating(placed, placed, false);
    expect(lost.elo).toBe(916); expect(lost.best).toBe(932);
    expect(updatedRating({ ...ninth, elo: -100 }, { ...ninth, elo: -100 }, false).elo).toBe(-132);
    expect(updatedRating(initialRating(), initialRating(), true).best).toBeNull();
  });
  it('maps exact rank boundaries and widens the search without an artificial rematch ban', () => {
    expect([-1,899,900,1099,1100,1300,1500,1700].map(n => rankFor(n).en)).toEqual(['Bronze','Bronze','Silver','Silver','Gold','Platinum','Diamond','Master']);
    expect(matchingRange(0)).toBe(100); expect(matchingRange(15000)).toBe(200); expect(matchingRange(120000)).toBe(Infinity);
  });
});
