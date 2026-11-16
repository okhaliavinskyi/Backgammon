import { describe, expect, it } from 'vitest';
import { firstRankedDeadline, pendingResolution } from '../src/ranked-policy';

describe('ranked recovery after delayed work', () => {
  it('keeps an activated match after a lost queue acknowledgement, regardless of age', () => {
    expect(pendingResolution({ ready: true, cancelled: false }, 120000)).toBe('committed');
    expect(pendingResolution({ ready: true, cancelled: false }, 1000)).toBe('committed');
    expect(pendingResolution({ ready: false, cancelled: false }, 44999)).toBe('assign');
    expect(pendingResolution({ ready: false, cancelled: false }, 45000)).toBe('cancel');
    expect(pendingResolution({ ready: true, cancelled: true }, 120000)).toBe('cancel');
  });
  it('honors the earlier bank expiration when disconnect and bank deadlines are both overdue', () => {
    expect(firstRankedDeadline(200000, { player: 1, at: 100000 }, [0, null])).toEqual({ player: 1, at: 100000 });
    expect(firstRankedDeadline(200000, { player: 1, at: 150000 }, [0, null])).toEqual({ player: 0, at: 120000 });
  });
  it('expires the reconnect window at its boundary and resolves both-disconnected deterministically', () => {
    expect(firstRankedDeadline(119999, null, [0,null])).toBeNull();
    expect(firstRankedDeadline(120000, null, [0,null])).toEqual({ player: 0, at: 120000 });
    expect(firstRankedDeadline(200000, null, [10000,0])).toEqual({ player: 1, at: 120000 });
    expect(firstRankedDeadline(200000, null, [0,0])).toEqual({ player: 0, at: 120000 });
  });
});
