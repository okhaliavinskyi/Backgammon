import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, newMatch, type Rng } from '@nardy/core';
import { createDiceHistory, diceStats, loadDiceHistories, recordDice, saveDiceHistory } from '../../apps/web/src/lib/dice-history';
import { logAiDice } from '../src/ai-dice';
const settings = { variant: 'long' as const, matchLength: 1, cube: false };
const sequence = (...values: number[]): Rng => { let i = 0; return () => { if (i === values.length) throw Error('extra draw'); return values[i++]; }; };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('AI dice history', () => {
  it('preserves RNG and state, records opening retries, and separates player statistics', async () => {
    const send = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', send);
    const h = createDiceHistory();
    const m = recordDice(rng => newMatch(settings, rng), sequence(2, 2, 6, 1), h, null);
    expect(m).toEqual(newMatch(settings, sequence(2, 2, 6, 1)));
    expect(h.entries.map(e => e.accepted)).toEqual([false, true]);
    const operation = (rng: Rng) => applyAction(m, { type: 'roll', player: 0 }, rng);
    expect(recordDice(operation, sequence(1, 2), h, 0)).toEqual(operation(sequence(1, 2)));
    h.entries.push({ ...h.entries[2], player: 1, dice: [6, 6] });
    expect(diceStats(h.entries, 0)).toMatchObject({ count: 1, doubles: 0, average: 3, movement: 3 });
    expect(diceStats(h.entries, 1)).toMatchObject({ count: 1, doubles: 1, average: 12, movement: 24 });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('records the selected weighted pair rather than its sampling draws', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const h = createDiceHistory();
    const m = newMatch(settings, sequence(6, 1));
    m.recentDice = [[[1, 2]], []];
    const values = [1, 2, 3, 4, 5, 6, 1, 2];
    const operation = (rng: Rng) => applyAction(m, { type: 'roll', player: 0 }, rng);
    const next = recordDice(operation, sequence(...values), h, 0);
    expect(next).toEqual(operation(sequence(...values)));
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0].dice).toEqual(next.dice);
  });
  it('keeps the latest ten histories and updates an existing match without duplicates', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k, v) });
    for (let i = 0; i < 12; i++) saveDiceHistory(createDiceHistory());
    const last = loadDiceHistories()[0];
    last.finished = true;
    saveDiceHistory(last);
    expect(loadDiceHistories()).toHaveLength(10);
    expect(loadDiceHistories()[0]).toEqual(last);
  });
  it('accepts only bounded, validated entries and logs no extra client fields', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const entry = { gameNo: 1, seq: 1, at: new Date().toISOString(), player: 0, dice: [1, 2], kind: 'turn', accepted: true, name: 'private' };
    const send = (entries: unknown) => logAiDice(new Request('https://example.com/api/ai/dice', { method: 'POST', body: JSON.stringify({ matchId: crypto.randomUUID(), entries }) }));
    expect((await send([entry])).status).toBe(200);
    expect(log.mock.calls[0][0]).toMatchObject({ event: 'ai_dice_roll', authoritative: false, pair: '1:2' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    expect((await send([{ ...entry, dice: [7, 0] }])).status).toBe(400);
    expect((await send([entry, { ...entry, player: 3 }])).status).toBe(400);
    expect(log).toHaveBeenCalledTimes(1);
    expect((await send(Array(101).fill(entry))).status).toBe(400);
  });
});
