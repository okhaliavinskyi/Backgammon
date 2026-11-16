import { DurableObject } from 'cloudflare:workers';
import {
  Action,
  CLAIM_AFTER_MS,
  ChatLine,
  ClientMsg,
  Clocks,
  Color,
  EMOJIS,
  GameError,
  MatchState,
  RoomSettings,
  RoomView,
  ServerMsg,
  applyAction,
  chooseTurn,
  newMatch,
  other,
  sanitizeChat,
  sanitizeName,
  shouldTake,
} from '@nardy/core';
import type { Env } from './index';
import { cryptoRng, hashPassword, randomToken, safeEqual } from './util';

const IDLE_MS = 30 * 60 * 1000;
const NEXT_GAME_DELAY_MS = 6000;
const CHAT_HISTORY = 50;
const CHAT_INTERVAL_MS = 700;
const MAX_MSG_BYTES = 4096;

interface Seat {
  name: string;
  token: string;
  disconnectedAt: number | null;
}

interface Persisted {
  id: string;
  settings: RoomSettings;
  salt: string;
  passHash: string | null;
  createdAt: number;
  lastActivity: number;
  seats: [Seat | null, Seat | null];
  match: MatchState | null;
  bank: [number, number] | null;
  turnStartedAt: number | null;
  activeKey: string | null;
  nextGameAt: number | null;
  rematch: [boolean, boolean];
  chat: ChatLine[];
}

interface Attachment {
  seat: Color | null;
}

export interface RoomInfo {
  exists: boolean;
  id?: string;
  settings?: RoomSettings;
  hasPassword?: boolean;
  seatsTaken?: number;
  seatsOffline?: number;
  offlineName?: string | null;
  status?: RoomView['status'];
}

/** One Durable Object per room: authoritative game state, clocks and sockets. */
export class RoomDO extends DurableObject<Env> {
  private s: Persisted | null = null;
  private lastChat = new Map<Color, number>();
  private lastEmoji = new Map<Color, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<Persisted>('room')) ?? null;
    });
  }

  // ───────────── RPC from the Worker ─────────────

  async init(id: string, settings: RoomSettings, password: string | null, hostName: string): Promise<boolean> {
    if (this.s) return false; // id collision
    const salt = randomToken();
    const now = Date.now();
    this.s = {
      id,
      settings,
      salt,
      passHash: password ? await hashPassword(password, salt) : null,
      createdAt: now,
      lastActivity: now,
      seats: [null, null],
      match: null,
      bank: null,
      turnStartedAt: null,
      activeKey: null,
      nextGameAt: null,
      rematch: [false, false],
      chat: [],
    };
    await this.save();
    if (settings.isPublic) {
      await this.lobby().upsert({ id, host: sanitizeName(hostName), settings, hasPassword: !!password, createdAt: now });
    }
    return true;
  }

  private offlineSeat(): Color | null {
    const s = this.s!;
    for (const c of [0, 1] as Color[]) if (s.seats[c] && s.seats[c]!.disconnectedAt !== null) return c;
    return null;
  }

  async info(): Promise<RoomInfo> {
    const s = this.s;
    if (!s) return { exists: false };
    return {
      exists: true,
      id: s.id,
      settings: s.settings,
      hasPassword: !!s.passHash,
      seatsTaken: s.seats.filter(Boolean).length,
      seatsOffline: s.seats.filter((x) => x && x.disconnectedAt !== null).length,
      offlineName: (() => { const c = this.offlineSeat(); return c === null ? null : s.seats[c]!.name; })(),
      status: this.status(),
    };
  }

  // ───────────── WebSocket ─────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    if (!this.s) return new Response('Room not found', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.s) return ws.close(4404, 'room_gone');
    if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return this.send(ws, { t: 'error', code: 'bad_message' });
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(ws, { t: 'error', code: 'bad_message' });
    }
    const att = ws.deserializeAttachment() as Attachment;
    if (msg.t === 'ping') return this.send(ws, { t: 'pong', serverNow: Date.now() });
    if (msg.t === 'hello') return this.onHello(ws, msg);
    if (att.seat === null) return this.send(ws, { t: 'error', code: 'not_joined' });
    await this.onPlayerMsg(ws, att.seat, msg);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const s = this.s;
    if (!s) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.seat === null) return;
    const seat = att.seat;
    const stillConnected = this.ctx.getWebSockets().some((w) => w !== ws && (w.deserializeAttachment() as Attachment)?.seat === seat);
    const st = s.seats[seat];
    if (!stillConnected && st) {
      st.disconnectedAt = Date.now();
      await this.persistAndBroadcast();
      if (seat === 0 && this.status() === 'waiting' && s.settings.isPublic) await this.lobby().remove(s.id);
    }
  }

  private async onHello(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>): Promise<void> {
    const s = this.s!;
    const current = (ws.deserializeAttachment() as Attachment).seat;
    if (current !== null) {
      // Already seated on this socket: never let one connection take a second seat.
      this.send(ws, { t: 'welcome', you: current, token: s.seats[current]!.token });
      return this.persistAndBroadcast(ws);
    }
    const name = sanitizeName(msg.name);
    let seat: Color | null = null;
    // Reconnect by token.
    if (typeof msg.token === 'string') {
      for (const c of [0, 1] as Color[]) {
        const st = s.seats[c];
        if (st && safeEqual(st.token, msg.token)) seat = c;
      }
    }
    if (seat === null) {
      if (s.passHash) {
        const h = await hashPassword(typeof msg.password === 'string' ? msg.password : '', s.salt);
        if (!safeEqual(h, s.passHash)) {
          this.send(ws, { t: 'error', code: 'bad_password' });
          return ws.close(4401, 'bad_password');
        }
      }
      const free = s.seats[0] === null ? 0 : s.seats[1] === null ? 1 : this.offlineSeat();
      if (free === null) {
        this.send(ws, { t: 'error', code: 'room_full' });
        return ws.close(4403, 'room_full');
      }
      seat = free;
      s.seats[seat] = { name, token: randomToken(), disconnectedAt: null };
    } else {
      s.seats[seat]!.name = name;
      s.seats[seat]!.disconnectedAt = null;
    }
    ws.serializeAttachment({ seat } satisfies Attachment);
    s.lastActivity = Date.now();
    this.send(ws, { t: 'welcome', you: seat, token: s.seats[seat]!.token });

    if (!s.match && s.seats[0] && s.seats[1]) {
      this.startMatch();
      if (s.settings.isPublic) await this.lobby().remove(s.id);
    } else if (this.status() === 'waiting' && s.settings.isPublic && seat === 0) {
      await this.lobby().upsert({ id: s.id, host: name, settings: s.settings, hasPassword: !!s.passHash, createdAt: s.createdAt });
    }
    await this.persistAndBroadcast(ws);
  }

  private startMatch(): void {
    const s = this.s!;
    s.match = newMatch({ variant: s.settings.variant, matchLength: s.settings.matchLength, cube: s.settings.cube }, cryptoRng);
    s.bank = s.settings.bank > 0 ? [s.settings.bank * 1000, s.settings.bank * 1000] : null;
    s.turnStartedAt = null;
    s.activeKey = null;
    s.nextGameAt = null;
    s.rematch = [false, false];
    this.syncClock(Date.now());
  }

  private async onPlayerMsg(ws: WebSocket, seat: Color, msg: ClientMsg): Promise<void> {
    const s = this.s!;
    const now = Date.now();
    s.lastActivity = now;
    switch (msg.t) {
      case 'chat': {
        const text = sanitizeChat(msg.text);
        if (!text) return;
        if (now - (this.lastChat.get(seat) ?? 0) < CHAT_INTERVAL_MS) return this.send(ws, { t: 'error', code: 'slow_down' });
        this.lastChat.set(seat, now);
        const line: ChatLine = { from: seat, text, at: now };
        s.chat.push(line);
        if (s.chat.length > CHAT_HISTORY) s.chat.splice(0, s.chat.length - CHAT_HISTORY);
        await this.save();
        return this.broadcast({ t: 'chat', line });
      }
      case 'emoji': {
        if (!(EMOJIS as readonly string[]).includes(msg.e)) return;
        if (now - (this.lastEmoji.get(seat) ?? 0) < CHAT_INTERVAL_MS) return;
        this.lastEmoji.set(seat, now);
        return this.broadcast({ t: 'emoji', from: seat, e: msg.e });
      }
      case 'rematch': {
        if (!s.match || s.match.phase !== 'matchover') return this.send(ws, { t: 'error', code: 'not_over' });
        s.rematch[seat] = true;
        if (s.rematch[0] && s.rematch[1]) this.startMatch();
        return this.persistAndBroadcast();
      }
      case 'claim': {
        const opp = s.seats[other(seat)];
        if (!s.match || !opp || opp.disconnectedAt === null || now - opp.disconnectedAt < CLAIM_AFTER_MS)
          return this.send(ws, { t: 'error', code: 'cannot_claim' });
        return this.act(ws, { type: 'timeout', player: other(seat) });
      }
      case 'roll':
        return this.act(ws, { type: 'roll', player: seat }); // dice are always generated server-side
      case 'move':
        if (!Array.isArray(msg.steps) || msg.steps.length > 4) return this.send(ws, { t: 'error', code: 'bad_message' });
        return this.act(ws, {
          type: 'move',
          player: seat,
          steps: msg.steps.map((x) => ({ from: Number(x?.from), die: Number(x?.die) })),
        });
      case 'double':
      case 'take':
      case 'drop':
      case 'resign':
        return this.act(ws, { type: msg.t, player: seat });
      default:
        return this.send(ws, { t: 'error', code: 'unknown' });
    }
  }

  private async act(ws: WebSocket | null, action: Action): Promise<void> {
    const s = this.s!;
    if (!s.match) {
      if (ws) this.send(ws, { t: 'error', code: 'not_started' });
      return;
    }
    const now = Date.now();
    // Charge the running clock first: an action after the deadline is a timeout.
    if (this.deadline() !== null && now > this.deadline()! + 500 && action.type !== 'timeout') {
      await this.onAlarmWork(now);
      if (ws) this.send(ws, { t: 'error', code: 'too_late' });
      return;
    }
    try {
      s.match = applyAction(s.match, action, cryptoRng);
    } catch (e) {
      if (e instanceof GameError) {
        if (ws) this.send(ws, { t: 'error', code: e.code });
        return;
      }
      throw e;
    }
    this.syncClock(now);
    await this.persistAndBroadcast();
  }

  // ───────────── clocks ─────────────

  /** Who is expected to act now (null when no clock should run). */
  private active(): Color | null {
    const m = this.s!.match;
    if (!m) return null;
    if (m.phase === 'roll' || m.phase === 'move') return m.turn;
    if (m.phase === 'cube') return other(m.turn);
    return null;
  }

  /** After every state change: charge the previous player's bank and restart the clock if the actor changed. */
  private syncClock(now: number): void {
    const s = this.s!;
    const m = s.match!;
    const act = this.active();
    // Turn index is the same for the roll and the move of one turn.
    const turnIdx = m.turnsTaken[0] + m.turnsTaken[1] + (m.phase === 'move' ? 0 : 1);
    const key = act === null ? null : `${m.gameNo}:${turnIdx}:${m.phase === 'cube' ? 'c' : 't'}:${act}`;
    if (key === s.activeKey) return;
    // Charge the previous actor.
    if (s.bank && s.turnStartedAt !== null && s.activeKey) {
      const prev = Number(s.activeKey.split(':')[3]) as Color;
      const delay = s.settings.moveTimer * 1000;
      s.bank[prev] = Math.max(0, s.bank[prev] - Math.max(0, now - s.turnStartedAt - delay));
    }
    // Bank is per game: a finished game refills both banks for the next one.
    if (s.bank && (m.phase === 'gameover' || m.phase === 'matchover')) s.bank = [s.settings.bank * 1000, s.settings.bank * 1000];
    s.activeKey = key;
    s.turnStartedAt = act === null ? null : now;
    s.nextGameAt = m.phase === 'gameover' ? now + NEXT_GAME_DELAY_MS : null;
  }

  private deadline(): number | null {
    const s = this.s!;
    const act = this.active();
    if (act === null || s.turnStartedAt === null) return null;
    const delay = s.settings.moveTimer * 1000;
    if (s.bank) return s.turnStartedAt + delay + s.bank[act];
    if (delay > 0) return s.turnStartedAt + delay;
    return null;
  }

  private async scheduleAlarm(): Promise<void> {
    const s = this.s!;
    const times = [s.lastActivity + IDLE_MS];
    const d = this.deadline();
    if (d !== null) times.push(d);
    if (s.nextGameAt !== null) times.push(s.nextGameAt);
    await this.ctx.storage.setAlarm(Math.min(...times));
  }

  override async alarm(): Promise<void> {
    if (!this.s) return;
    await this.onAlarmWork(Date.now());
  }

  private async onAlarmWork(now: number): Promise<void> {
    const s = this.s!;
    if (now >= s.lastActivity + IDLE_MS) {
      const anyoneHere = this.ctx.getWebSockets().some((w) => (w.deserializeAttachment() as Attachment)?.seat !== null);
      if (!anyoneHere) return this.destroy();
      s.lastActivity = now; // players are connected and thinking — keep the room alive
      await this.save();
    }
    let changed = false;
    if (s.match && s.nextGameAt !== null && now >= s.nextGameAt && s.match.phase === 'gameover') {
      s.match = applyAction(s.match, { type: 'next', player: 0 }, cryptoRng);
      this.syncClock(now);
      changed = true;
    }
    const d = this.deadline();
    if (s.match && d !== null && now >= d) {
      const act = this.active()!;
      if (s.bank) {
        s.match = applyAction(s.match, { type: 'timeout', player: act }, cryptoRng);
      } else {
        s.match = this.autoPlay(s.match, act);
      }
      this.syncClock(now);
      changed = true;
    }
    if (changed) await this.persistAndBroadcast();
    else await this.scheduleAlarm();
  }

  /** Move timer expired: play for the absent player (roll + reasonable move, or answer the cube). */
  private autoPlay(m: MatchState, player: Color): MatchState {
    if (m.phase === 'cube') return applyAction(m, { type: shouldTake(m, player, 'amateur') ? 'take' : 'drop', player }, cryptoRng);
    if (m.phase === 'roll') m = applyAction(m, { type: 'roll', player }, cryptoRng);
    if (m.phase === 'move' && m.turn === player) {
      m = applyAction(m, { type: 'move', player, steps: chooseTurn(m, 'amateur').map((x) => ({ from: x.from, die: x.die })) }, cryptoRng);
    }
    return m;
  }

  private async destroy(): Promise<void> {
    const s = this.s!;
    for (const ws of this.ctx.getWebSockets()) ws.close(4404, 'room_expired');
    if (s.settings.isPublic) await this.lobby().remove(s.id);
    this.s = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ───────────── helpers ─────────────

  private status(): RoomView['status'] {
    const m = this.s?.match;
    if (!m) return 'waiting';
    return m.phase === 'matchover' ? 'finished' : 'playing';
  }

  private view(): RoomView {
    const s = this.s!;
    const seat = (c: Color) => {
      const st = s.seats[c];
      return st ? { name: st.name, connected: st.disconnectedAt === null, disconnectedAt: st.disconnectedAt } : null;
    };
    return { id: s.id, settings: s.settings, hasPassword: !!s.passHash, players: [seat(0), seat(1)], status: this.status(), rematch: s.rematch };
  }

  private clocks(): Clocks {
    const s = this.s!;
    return { bank: s.bank, turnStartedAt: s.turnStartedAt, moveTimerMs: s.settings.moveTimer * 1000, nextGameAt: s.nextGameAt };
  }

  private async save(): Promise<void> {
    if (this.s) await this.ctx.storage.put('room', this.s);
  }

  private async persistAndBroadcast(withChatFor?: WebSocket): Promise<void> {
    await this.save();
    await this.scheduleAlarm();
    const s = this.s!;
    const base: ServerMsg = { t: 'state', room: this.view(), match: s.match, clocks: this.clocks(), serverNow: Date.now() };
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      if (att?.seat === null) continue;
      this.send(ws, ws === withChatFor ? { ...base, chat: s.chat } : base);
    }
  }

  private broadcast(msg: ServerMsg): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      if (att?.seat !== null) this.send(ws, msg);
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closed */
    }
  }

  private lobby() {
    return this.env.LOBBY.get(this.env.LOBBY.idFromName('global'));
  }
}
