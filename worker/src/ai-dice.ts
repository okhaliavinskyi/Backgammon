import { BodyError, json, readJsonObject } from './util';

export async function logAiDice(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await readJsonObject(request, 16384); }
  catch (e) { return json({ error: e instanceof BodyError ? e.message : 'bad_json' }, e instanceof BodyError ? e.status : 400); }
  if (typeof body.matchId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.matchId) ||
      !Array.isArray(body.entries) || !body.entries.length || body.entries.length > 100) return json({ error: 'bad_json' }, 400);
  const entries = [];
  for (const e of body.entries) {
    if (!e || typeof e !== 'object' || !Number.isSafeInteger(e.gameNo) || e.gameNo < 1 ||
        !Number.isSafeInteger(e.seq) || e.seq < 0 || typeof e.at !== 'string' || e.at.length > 30 || !Number.isFinite(Date.parse(e.at)) ||
        !['turn', 'opening'].includes(e.kind) || typeof e.accepted !== 'boolean' ||
        (e.kind === 'opening' ? e.player !== null : (e.player !== 0 && e.player !== 1) || !e.accepted) ||
        !Array.isArray(e.dice) || e.dice.length !== 2 || !e.dice.every((d: unknown) => Number.isInteger(d) && Number(d) >= 1 && Number(d) <= 6)) return json({ error: 'bad_json' }, 400);
    // Whitelist fields. No names, cookies, profile IDs, or arbitrary client strings.
    entries.push({ gameNo: e.gameNo, seq: e.seq, clientAt: e.at, player: e.player,
      kind: e.kind, accepted: e.accepted, dice: e.dice, pair: [...e.dice].sort().join(':') });
  }
  for (const e of entries) console.log({ event: 'ai_dice_roll', schemaVersion: 1, source: 'client',
    authoritative: false, matchId: body.matchId, receivedAt: new Date().toISOString(), ...e });
  return json({ ok: true });
}
