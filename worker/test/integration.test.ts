/**
 * Integration test against a running worker (wrangler dev or production).
 *   NARDY_URL=http://127.0.0.1:8787 npx vitest run
 */
import { describe, expect, it } from 'vitest';
import { MatchState, ServerMsg, chooseTurn } from '@nardy/core';

const BASE = process.env.NARDY_URL ?? 'http://127.0.0.1:8787';
const WS = BASE.replace(/^http/, 'ws');

class Client {
  ws!: WebSocket;
  msgs: ServerMsg[] = [];
  waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  closed: number | null = null;
  async open(id: string) {
    this.ws = new WebSocket(`${WS}/api/rooms/${id}/ws`);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string) as ServerMsg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
    };
    this.ws.onclose = (e) => (this.closed = e.code);
    await new Promise((r) => (this.ws.onopen = r));
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  wait(pred: (m: ServerMsg) => boolean, ms = 5000): Promise<ServerMsg> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), ms);
      this.waiters.push({ pred, res: (m) => (clearTimeout(t), res(m)) });
    });
  }
  lastState(): MatchState | null {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i];
      if (m.t === 'state') return m.match;
    }
    return null;
  }
}

async function createRoom(settings: object, password?: string) {
  const r = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ settings, password, name: 'Host' }) });
  expect(r.status).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

describe('room server', () => {
  it('password, seats, illegal moves, full game flow and reconnect', async () => {
    const id = await createRoom({ variant: 'short', matchLength: 1, moveTimer: 0, bank: 0, isPublic: true }, 'secret');
    const info = await (await fetch(`${BASE}/api/rooms/${id}`)).json();
    expect(info).toMatchObject({ exists: true, hasPassword: true, seatsTaken: 0 });

    const lobby = (await (await fetch(`${BASE}/api/rooms`)).json()) as { rooms: { id: string }[] };
    expect(lobby.rooms.some((r) => r.id === id)).toBe(true);

    const bad = new Client();
    await bad.open(id);
    bad.send({ t: 'hello', name: 'Hacker', password: 'nope' });
    const err = await bad.wait((m) => m.t === 'error');
    expect(err).toMatchObject({ code: 'bad_password' });

    const a = new Client();
    const b = new Client();
    await a.open(id);
    a.send({ t: 'hello', name: 'Alice', password: 'secret' });
    const wa = await a.wait((m) => m.t === 'welcome');
    await b.open(id);
    b.send({ t: 'hello', name: 'Bob', password: 'secret' });
    const wb = await b.wait((m) => m.t === 'welcome');
    expect(wa.t === 'welcome' && wa.you).toBe(0);
    expect(wb.t === 'welcome' && wb.you).toBe(1);
    await a.wait((m) => m.t === 'state' && !!m.match);

    const third = new Client();
    await third.open(id);
    third.send({ t: 'hello', name: 'Eve', password: 'secret' });
    expect(await third.wait((m) => m.t === 'error')).toMatchObject({ code: 'room_full' });

    // Lobby no longer lists a full room.
    const lobby2 = (await (await fetch(`${BASE}/api/rooms`)).json()) as { rooms: { id: string }[] };
    expect(lobby2.rooms.some((r) => r.id === id)).toBe(false);

    // Illegal move is rejected.
    const st = a.lastState()!;
    const mover = st.turn === 0 ? a : b;
    mover.send({ t: 'move', steps: [{ from: 0, die: 6 }, { from: 0, die: 6 }] });
    const e2 = await mover.wait((m) => m.t === 'error');
    expect(e2.t).toBe('error');

    // Client cannot inject dice.
    // Play the game out with the AI on both sides.
    const clients = [a, b];
    let guard = 0;
    let reconnected = false;
    for (;;) {
      const m = clients[0].lastState()!;
      if (m.phase === 'matchover') break;
      if (guard++ > 600) throw new Error('game did not finish');
      const c = clients[m.turn];
      const seq = m.seq;
      if (m.phase === 'roll') c.send({ t: 'roll', dice: [6, 6] });
      else if (m.phase === 'move') c.send({ t: 'move', steps: chooseTurn(m, 'amateur').map((s) => ({ from: s.from, die: s.die })) });
      await clients[0].wait((x) => x.t === 'state' && !!x.match && x.match.seq > seq);
      if (!reconnected && guard === 10) {
        // Bob reloads the page: reconnect with token.
        b.ws.close();
        const b2 = new Client();
        await b2.open(id);
        b2.send({ t: 'hello', name: 'Bob', token: (wb as { token: string }).token });
        const w = await b2.wait((x) => x.t === 'welcome');
        expect(w).toMatchObject({ you: 1 });
        await b2.wait((x) => x.t === 'state');
        clients[1] = b2;
        reconnected = true;
      }
    }
    const final = clients[0].lastState()!;
    expect(final.matchWinner).not.toBeNull();
    expect(Math.max(...final.score)).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('chat and emoji are relayed and sanitized', async () => {
    const id = await createRoom({ variant: 'long', matchLength: 1, isPublic: false });
    const a = new Client();
    const b = new Client();
    await a.open(id);
    a.send({ t: 'hello', name: '<b>Alice</b>' });
    await a.wait((m) => m.t === 'welcome');
    await b.open(id);
    b.send({ t: 'hello', name: 'Bob' });
    await b.wait((m) => m.t === 'welcome');
    const s = (await b.wait((m) => m.t === 'state' && !!m.match)) as Extract<ServerMsg, { t: 'state' }>;
    expect(s.room.players[0]!.name).toBe('bAlice/b');
    a.send({ t: 'chat', text: 'привет' + 'x'.repeat(500) });
    const c = await b.wait((m) => m.t === 'chat');
    expect(c.t === 'chat' && c.line.text.length).toBe(200);
    a.send({ t: 'emoji', e: '🔥' });
    expect(await b.wait((m) => m.t === 'emoji')).toMatchObject({ e: '🔥', from: 0 });
  });

  it('move timer auto-plays for an idle player', async () => {
    const id = await createRoom({ variant: 'long', matchLength: 1, moveTimer: 15, isPublic: false });
    const a = new Client();
    const b = new Client();
    await a.open(id);
    a.send({ t: 'hello', name: 'A' });
    await b.open(id);
    b.send({ t: 'hello', name: 'B' });
    const s = (await a.wait((m) => m.t === 'state' && !!m.match)) as Extract<ServerMsg, { t: 'state' }>;
    expect(s.clocks.turnStartedAt).not.toBeNull();
    const seq = s.match!.seq;
    const next = await a.wait((m) => m.t === 'state' && !!m.match && m.match.seq > seq, 20000);
    expect(next.t === 'state' && next.match!.turn).not.toBe(s.match!.turn);
  }, 30_000);

  it('unknown room returns exists:false', async () => {
    const r = await (await fetch(`${BASE}/api/rooms/ZZZZZZ`)).json();
    expect(r).toEqual({ exists: false });
  });
});

describe('hardening', () => {
const BASE2 = process.env.NARDY_URL ?? 'http://127.0.0.1:8787';
async function fullRoom(password?: string) {
  const r = await fetch(`${BASE2}/api/rooms`, { method: 'POST', body: JSON.stringify({ settings: { isPublic: false, moveTimer: 0, bank: 0 }, password }) });
  const { id } = (await r.json()) as { id: string };
  const a = new Client(); await a.open(id); a.send({ t: 'hello', name: 'Alice', password });
  const wa = (await a.wait((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
  const b = new Client(); await b.open(id); b.send({ t: 'hello', name: 'Bob', password });
  const wb = (await b.wait((m) => m.t === 'welcome')) as Extract<ServerMsg, { t: 'welcome' }>;
  await a.wait((m) => m.t === 'state' && !!m.match);
  return { id, a, b, wa, wb };
}
const info = async (id: string) => (await fetch(`${BASE2}/api/rooms/${id}`)).json();
const settle = () => new Promise((r) => setTimeout(r, 300));
const reply = (c: Client) => c.wait((m) => m.t === 'welcome' || m.t === 'error');

it('both online: no token → room_full, info says 0 offline', async () => {
  const { id } = await fullRoom('pw');
  expect(await info(id)).toMatchObject({ seatsTaken: 2, seatsOffline: 0, offlineName: null });
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Eve', password: 'pw' });
  expect(await reply(c)).toMatchObject({ t: 'error', code: 'room_full' });
});

it('offline seat: no token + right password → takes the seat, old token dead', async () => {
  const { id, b, wb } = await fullRoom('pw');
  b.ws.close(); await settle();
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Bob2', password: 'pw' });
  const w = await reply(c);
  expect(w).toMatchObject({ t: 'welcome', you: 1 });
  expect((w as Extract<ServerMsg, { t: 'welcome' }>).token).not.toBe(wb.token);
  c.ws.close(); await settle();
  // A live old token would be welcomed regardless of password; bad_password proves it no longer matches.
  const old = new Client(); await old.open(id); old.send({ t: 'hello', name: 'Bob', token: wb.token, password: 'nope' });
  expect(await reply(old)).toMatchObject({ t: 'error', code: 'bad_password' });
});

it('offline seat: info names it; wrong password → bad_password, seat untouched', async () => {
  const { id, b } = await fullRoom('pw');
  b.ws.close(); await settle();
  expect(await info(id)).toMatchObject({ seatsOffline: 1, offlineName: 'Bob' });
  const c = new Client(); await c.open(id); c.send({ t: 'hello', name: 'Eve', password: 'x' });
  expect(await reply(c)).toMatchObject({ t: 'error', code: 'bad_password' });
  expect(await info(id)).toMatchObject({ seatsOffline: 1, offlineName: 'Bob' });
});

  it('a second hello on the same socket cannot take the other seat', async () => {
    const r = await fetch(`${process.env.NARDY_URL ?? 'http://127.0.0.1:8787'}/api/rooms`, { method: 'POST', body: JSON.stringify({ settings: { isPublic: false } }) });
    const { id } = (await r.json()) as { id: string };
    const a = new Client();
    await a.open(id);
    a.send({ t: 'hello', name: 'A' });
    await a.wait((m) => m.t === 'welcome');
    a.send({ t: 'hello', name: 'A2' });
    const w2 = await a.wait((m) => m.t === 'welcome');
    expect(w2).toMatchObject({ you: 0 });
    const info = await (await fetch(`${process.env.NARDY_URL ?? 'http://127.0.0.1:8787'}/api/rooms/${id}`)).json();
    expect(info).toMatchObject({ seatsTaken: 1, status: 'waiting' });
  });
});
