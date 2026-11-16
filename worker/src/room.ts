import { resolveIdentity, sessionProfile } from './auth-util';
import { firstRankedDeadline } from './ranked-policy';
import { eloChange, type Rating, type RatingEvent, type Variant } from '@nardy/core';
import { DurableObject } from 'cloudflare:workers';
import {
  Action,
  type ProgressEvent,
  type CosmeticKind,
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
  profile?: string;
  cosmetics?: Partial<Record<CosmeticKind, string>>;
  token: string;
  disconnectedAt: number | null;
}

interface RankedState {
  matchId: string;
  profiles: [string, string]; ratings: [Rating, Rating]; ready: boolean; joinBy: number; cancelled: boolean;
  results?: [RatingEvent, RatingEvent]; delivered: [boolean, boolean];
}

interface Persisted {
  ranked?: RankedState;
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
  progressMatch?: string;
  progressTurns?: [number, number];
  progressAllowed?: [boolean, boolean];
  progressOutbox?: { profile: string; event: ProgressEvent }[];
  progressRecorded?: string;
  authWindow?: { start: number; attempts: number };
}

interface Attachment {
  session?: string;
  profile?: string;
  seat: Color | null;
}

export interface RoomInfo {
  exists: boolean;
  ranked?: boolean;
  cancelled?: boolean;
  id?: string;
  hasPassword?: boolean;
  seatsTaken?: number;
  status?: RoomView['status'];
}

/** One Durable Object per room: authoritative game state, clocks and sockets. */
export class RoomDO extends DurableObject<Env> {
  private s: Persisted | null = null;
  private messages: Promise<void> = Promise.resolve();
  private startingMatch: Promise<void> | null = null;
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
    await this.scheduleAlarm();
    if (settings.isPublic) {
      await this.lobby().upsert({ id, host: sanitizeName(hostName), settings, hasPassword: !!password, createdAt: now });
    }
    return true;
  }

  async initRanked(id: string, variant: Variant, players: [{ profile: string; name: string; rating: Rating }, { profile: string; name: string; rating: Rating }]): Promise<boolean> {
    return this.enqueueValue(async () => {
      if (this.s) return !!this.s.ranked && this.s.ranked.profiles.every((p,c) => p === players[c].profile);
      if (!await this.init(id, { variant, matchLength: 3, moveTimer: 15, bank: 300, cube: variant === 'short', isPublic: false }, null, players[0].name)) return false;
      this.s!.ranked = { matchId: crypto.randomUUID(), profiles: [players[0].profile, players[1].profile], ratings: [players[0].rating, players[1].rating], ready: false, joinBy: Date.now() + 60000, cancelled: false, delivered: [false,false] };
      this.s!.seats = players.map(p => ({ name: p.name, profile: p.profile, token: randomToken(), disconnectedAt: Date.now() })) as [Seat,Seat];
      await this.save(); await this.scheduleAlarm(); return true;
    });
  }
  rankedLifecycle(): { ready: boolean; cancelled: boolean } {
    return { ready: this.s?.ranked?.ready ?? false, cancelled: this.s?.ranked?.cancelled ?? true };
  }

  async activateRanked(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.s?.ranked || this.s.ranked.cancelled) return;
      this.s.ranked.ready = true;
      if (!this.s.match && this.s.seats.every(st => st?.disconnectedAt === null)) await this.startMatch();
      await this.persistAndBroadcast();
    });
  }
  async cancelRanked(): Promise<void> { return this.enqueue(() => this.abortRanked()); }
  private async abortRanked(): Promise<void> {
    const s = this.s; if (!s?.ranked || s.match) return;
    s.ranked.cancelled = true; await this.save();
    for (const c of [0,1] as const) {
      if (s.ranked.delivered[c]) continue;
      await this.profile(s.ranked.profiles[c]).releaseRanked(s.id);
      await this.profile(s.ranked.profiles[c]).release(s.id);
      s.ranked.delivered[c] = true; await this.save();
    }
    await this.persistAndBroadcast();
  }
  private enqueueValue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.messages.then(work); this.messages = result.then(() => {}, () => {}); return result;
  }

  /** Internal RPC: no profile identifier is exposed through public room info. */
  profileConnected(secret: string): boolean {
    const s = this.s;
    if (!s || s.match?.phase === 'matchover') return false;
    return this.ctx.getWebSockets().some(ws => {
      const seat = (ws.deserializeAttachment() as Attachment)?.seat;
      return seat !== null && seat !== undefined && ws.readyState === WebSocket.OPEN && s.seats[seat]?.profile === secret;
    });
  }

  async info(): Promise<RoomInfo> {
    const s = this.s;
    if (!s) return { exists: false };
    return {
      exists: true,
      ...(s.ranked ? { ranked: true, cancelled: s.ranked.cancelled } : {}),
      id: s.id,
      hasPassword: !!s.passHash,
      seatsTaken: s.seats.filter(Boolean).length,
      status: this.status(),
    };
  }

  // ───────────── WebSocket ─────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    if (!this.s) return new Response('Room not found', { status: 404 });
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return new Response('Forbidden', { status: 403 });
    if (this.ctx.getWebSockets().length >= 12) return new Response('Too many connections', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    let identity: { profile: string | null; session: string | null };
    try { identity = await resolveIdentity(request.headers.get('Cookie'), this.env); }
    catch {
      if (this.s.ranked) return new Response('Authentication unavailable', { status: 503 });
      identity = { profile: null, session: null }; // New casual rooms remain playable during profile-service failures.
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat: null, profile: identity.profile ?? undefined, session: identity.session ?? undefined } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    return this.enqueue(() => this.handleMessage(ws, raw));
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const task = this.messages.then(work);
    this.messages = task.catch(() => {});
    return task;
  }

  private async handleMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.s) return ws.close(4404, 'room_gone');
    if (typeof raw !== 'string' || raw.length > MAX_MSG_BYTES) return this.send(ws, { t: 'error', code: 'bad_message' });
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(ws, { t: 'error', code: 'bad_message' });
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.send(ws, { t: 'error', code: 'bad_message' });
    const att = ws.deserializeAttachment() as Attachment;
    if (att.profile && (att.session ? await sessionProfile(att.session,this.env)!==att.profile : !await this.profile(att.profile).guestAllowed())) return ws.close(4401,'session_expired');
    if (msg.t === 'ping') {
      const profile = att.seat === null ? undefined : this.s.seats[att.seat]?.profile;
      if (profile && this.s.match?.phase !== 'matchover') await this.profile(profile).acquire(this.s.id).catch(() => false);
      return this.send(ws, { t: 'pong', serverNow: Date.now() });
    }
    if (msg.t === 'hello') return this.onHello(ws, msg);
    if (att.seat === null) return this.send(ws, { t: 'error', code: 'not_joined' });
    await this.onPlayerMsg(ws, att.seat, msg);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.enqueue(() => this.onSocketGone(ws));
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.enqueue(() => this.onSocketGone(ws));
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
      if (!s.match && st.profile) await this.profile(st.profile).release(s.id).catch(() => {});
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
    await this.settleRankedDeadline(Date.now());
    if (s.ranked && !s.match && Date.now() >= s.ranked.joinBy && !s.ranked.cancelled) await this.abortRanked();
    const proposedProfile = (ws.deserializeAttachment() as Attachment).profile;
    if (s.ranked && (s.ranked.cancelled || !proposedProfile || !s.ranked.profiles.includes(proposedProfile))) {
      return ws.close(4403, s.ranked.cancelled ? 'match_cancelled' : 'not_invited');
    }
    const name = sanitizeName(msg.name);
    let seat: Color | null = null;
    if (s.ranked) seat = s.ranked.profiles.indexOf(proposedProfile!) as Color;
    // Reconnect by token.
    if (!s.ranked && typeof msg.token === 'string') {
      for (const c of [0, 1] as Color[]) {
        const st = s.seats[c];
        if (st && safeEqual(st.token, msg.token)) seat = c;
      }
    }
    if (seat !== null && s.seats[seat]?.profile && proposedProfile !== s.seats[seat]!.profile) {
      // A pre-binding room token must not bypass email-session revocation.
      if (await this.profile(s.seats[seat]!.profile!).linkedAccount()) return ws.close(4401, 'session_expired');
    }
    if (seat === null) {
      const now = Date.now();
      if (!s.authWindow || now - s.authWindow.start >= 60_000) s.authWindow = { start: now, attempts: 0 };
      if (++s.authWindow.attempts > 20) {
        await this.save();
        this.send(ws, { t: 'error', code: 'rate_limited' });
        return ws.close(4403, 'rate_limited');
      }
      await this.save();
      if (s.passHash) {
        const h = await hashPassword(typeof msg.password === 'string' ? msg.password : '', s.salt);
        if (!safeEqual(h, s.passHash)) {
          this.send(ws, { t: 'error', code: 'bad_password' });
          return ws.close(4401, 'bad_password');
        }
      }
      const free = s.seats[0] === null ? 0 : s.seats[1] === null ? 1 : null;
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
    const proposed = (ws.deserializeAttachment() as Attachment).profile;
    const st = s.seats[seat]!;
    if (proposed && !st.profile && !s.match) {
      try {
        const p = await this.profile(proposed).getProfile();
        if (p && s.seats[other(seat)]?.profile !== proposed) {
          st.profile = proposed; st.cosmetics = p.equipped;
        }
      } catch { /* Progress outages must not block casual rooms. */ }
    }
    if (st.profile && proposed === st.profile) {
      try { st.cosmetics = (await this.profile(st.profile).getProfile())?.equipped ?? st.cosmetics; } catch { /* Keep the last known appearance. */ }
    }
    ws.serializeAttachment({ seat, profile: proposed, session: (ws.deserializeAttachment() as Attachment).session } satisfies Attachment);
    s.lastActivity = Date.now();
    this.send(ws, { t: 'welcome', you: seat, token: s.seats[seat]!.token });

    if (!s.match && s.seats[0] && s.seats[1] && (!s.ranked || (s.ranked.ready && s.seats.every(st => st?.disconnectedAt === null)))) {
      await this.startMatch();
      if (s.settings.isPublic) await this.lobby().remove(s.id);
    } else if (this.status() === 'waiting' && s.settings.isPublic && seat === 0) {
      await this.lobby().upsert({ id: s.id, host: name, settings: s.settings, hasPassword: !!s.passHash, createdAt: s.createdAt });
    }
    await this.persistAndBroadcast(ws);
  }

  private async startMatch(): Promise<void> {
    if (this.startingMatch) return this.startingMatch;
    this.startingMatch = this.doStartMatch().finally(() => { this.startingMatch = null; });
    return this.startingMatch;
  }

  private async doStartMatch(): Promise<void> {
    const s = this.s!;
    s.progressAllowed = [false, false];
    for (const c of [0, 1] as Color[]) {
      const id = s.seats[c]?.profile;
      if (id) s.progressAllowed[c] = await this.profile(id).acquire(s.id).catch(() => false);
    }
    s.progressMatch = crypto.randomUUID();
    s.progressTurns = [0, 0];
    s.progressRecorded = undefined;
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
        if (s.ranked) return this.send(ws, { t: 'error', code: 'ranked_search_again' });
        if (!s.match || s.match.phase !== 'matchover') return this.send(ws, { t: 'error', code: 'not_over' });
        s.rematch[seat] = true;
        if (s.rematch[0] && s.rematch[1]) await this.startMatch();
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
        return this.act(ws, { type: s.ranked && msg.t === 'resign' ? 'timeout' : msg.t, player: seat });
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
    if (await this.settleRankedDeadline(now)) return;
    // Charge the running clock first: an action after the deadline is a timeout.
    if (this.deadline() !== null && now > this.deadline()! + 500 && action.type !== 'timeout') {
      await this.onAlarmWork(now);
      if (ws) this.send(ws, { t: 'error', code: 'too_late' });
      return;
    }
    try {
      const before = s.match;
      s.match = applyAction(before, action, cryptoRng);
      if ((action.type === 'move' || action.type === 'roll') &&
          (before.turn !== s.match.turn || s.match.result)) {
        s.progressTurns ??= [0, 0]; s.progressTurns[action.player]++;
      }
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
    const times = s.ranked && s.match && s.match.phase !== 'matchover' ? [] : [s.lastActivity + IDLE_MS];
    const d = this.deadline();
    if (d !== null) times.push(d);
    if (s.nextGameAt !== null) times.push(s.nextGameAt);
    if (s.progressOutbox?.length || ((s.ranked?.results || s.ranked?.cancelled) && s.ranked.delivered.some(done => !done))) times.push(Date.now() + 10000);
    if (s.ranked && !s.match && !s.ranked.cancelled) times.push(s.ranked.joinBy);
    if (s.ranked && s.match && s.match.phase !== 'matchover') for (const st of s.seats) {
      if (st?.disconnectedAt != null) times.push(st.disconnectedAt + CLAIM_AFTER_MS);
    }
    await this.ctx.storage.setAlarm(Math.min(...times));
  }

  override async alarm(): Promise<void> {
    if (!this.s) return;
    await this.ctx.storage.setAlarm(Date.now() + 10000);
    await this.enqueue(() => this.onAlarmWork(Date.now()));
  }

  private async settleRankedDeadline(now: number): Promise<boolean> {
    const s = this.s!;
    if (!s.ranked || !s.match || s.match.phase === 'matchover') return false;
    const deadline = this.deadline(), active = this.active();
    const expired = firstRankedDeadline(now, deadline !== null && active !== null ? { player: active, at: deadline } : null,
      [s.seats[0]?.disconnectedAt ?? null, s.seats[1]?.disconnectedAt ?? null]);
    if (!expired) return false;
    if (s.match.phase === 'gameover') {
      s.match = applyAction(s.match, { type: 'next', player: 0 }, cryptoRng);
      s.progressTurns = [0,0];
    }
    s.match = applyAction(s.match, { type: 'timeout', player: expired.player }, cryptoRng);
    this.syncClock(now); await this.persistAndBroadcast(); return true;
  }

  private async onAlarmWork(now: number): Promise<void> {
    const s = this.s!;
    if (s.ranked?.cancelled && s.ranked.delivered.some(done => !done)) { await this.abortRanked(); return; }
    if (s.ranked && !s.match && !s.ranked.cancelled && now >= s.ranked.joinBy) { await this.abortRanked(); return; }
    if (await this.settleRankedDeadline(now)) return;
    if (!(s.ranked && s.match && s.match.phase !== 'matchover') && now >= s.lastActivity + IDLE_MS && !s.progressOutbox?.length && !(s.ranked?.results && s.ranked.delivered.some(done => !done))) {
      const anyoneHere = this.ctx.getWebSockets().some((w) => (w.deserializeAttachment() as Attachment)?.seat !== null);
      if (!anyoneHere) return this.destroy();
      s.lastActivity = now; // players are connected and thinking — keep the room alive
      await this.save();
    }
    let changed = false;
    if (s.match && s.nextGameAt !== null && now >= s.nextGameAt && s.match.phase === 'gameover') {
      s.match = applyAction(s.match, { type: 'next', player: 0 }, cryptoRng);
      s.progressTurns = [0, 0];
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
    else if (s.progressOutbox?.length || (s.ranked?.results && s.ranked.delivered.some(done => !done))) await this.persistAndBroadcast();
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
      return st ? { rating: s.ranked?.ratings[c], cosmetics: st.cosmetics, name: st.name, connected: st.disconnectedAt === null, disconnectedAt: st.disconnectedAt } : null;
    };
    return { ranked: s.ranked ? { ratings: s.ranked.ratings, changes: s.ranked.results ? s.ranked.results.map(e => eloChange(e.own, e.opponent, e.won)) as [number,number] : undefined, settled: s.ranked.delivered.every(Boolean), cancelled: s.ranked.cancelled, joinBy: s.ranked.joinBy } : undefined, progressEligible: !!s.progressAllowed?.every(Boolean), progressEvent: s.progressRecorded, id: s.id, settings: s.settings, hasPassword: !!s.passHash, players: [seat(0), seat(1)], status: this.status(), rematch: s.rematch };
  }

  private clocks(): Clocks {
    const s = this.s!;
    return { bank: s.bank, turnStartedAt: s.turnStartedAt, moveTimerMs: s.settings.moveTimer * 1000, nextGameAt: s.nextGameAt };
  }

  private async save(): Promise<void> {
    if (this.s) await this.ctx.storage.put('room', this.s);
  }

  private async persistAndBroadcast(withChatFor?: WebSocket): Promise<void> {
    this.queueProgress();
    const ranked = this.s?.ranked, match = this.s?.match;
    if (ranked && match?.phase === 'matchover' && !ranked.results) {
      ranked.results = ([0,1] as const).map(c => ({ id: ranked.matchId, room: this.s!.id, variant: this.s!.settings.variant, own: ranked.ratings[c], opponent: ranked.ratings[other(c)], won: match.matchWinner === c, at: Date.now() })) as [RatingEvent,RatingEvent];
    }
    await this.save();
    await this.flushProgress();
    await this.scheduleAlarm();
    const s = this.s!;
    const base: ServerMsg = { t: 'state', room: this.view(), match: s.match, clocks: this.clocks(), serverNow: Date.now() };
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      if (att?.seat === null) continue;
      let progress: Extract<ServerMsg, { t: 'state' }>['progress'];
      const own = s.seats[att.seat!]?.profile, opponent = s.seats[other(att.seat!)]?.profile;
      if (own && opponent && att.profile === own && (s.match?.result || s.match?.seq === 0 || ws === withChatFor)) {
        try {
          const p = await this.profile(own).getProfile();
          if (p) progress = { profile: p, pair: await this.profile(own).pair(opponent, s.settings.variant) };
        } catch { /* Gameplay continues while progress is unavailable. */ }
      }
      this.send(ws, { ...base, room: { ...base.room, progressEligible: !!s.progressAllowed?.[att.seat!] }, ...(ws === withChatFor ? { chat: s.chat } : {}), ...(progress ? { progress } : {}) });
    }
  }

  private profile(id: string) { return this.env.PROFILE.get(this.env.PROFILE.idFromName(id)); }

  private queueProgress(): void {
    const s = this.s!, m = s.match;
    if (!m?.result || !s.progressMatch || s.progressRecorded === `${s.progressMatch}:${m.gameNo}`) return;
    s.progressRecorded = `${s.progressMatch}:${m.gameNo}`;
    const qualified = m.result.kind === 'normal' || (s.progressTurns?.every(t => t >= 10) ?? false);
    const at = Date.now();
    for (const c of [0, 1] as Color[]) {
      const id = s.seats[c]?.profile, opponent = s.seats[other(c)]?.profile;
      if (!id || !opponent || id === opponent) continue;
      (s.progressOutbox ??= []).push({ profile: id, event: {
        id: s.progressRecorded, room: s.id, opponent, variant: s.settings.variant,
        won: m.result.winner === c, qualified: qualified && !!s.progressAllowed?.[c],
        matchWon: m.phase === 'matchover' ? m.matchWinner === c : null, at,
      } });
    }
  }

  private async flushProgress(): Promise<void> {
    const s = this.s!;
    for (const item of [...(s.progressOutbox ?? [])]) {
      try {
        await this.profile(item.profile).record(item.event);
        s.progressOutbox = s.progressOutbox!.filter(x => x !== item);
        await this.save();
      } catch { break; } // Persisted outbox is retried by the room alarm.
    }
    if (s.ranked?.results) {
      for (const c of [0,1] as const) {
        if (s.ranked.delivered[c]) continue;
        try {
          await this.profile(s.ranked.profiles[c]).rate(s.ranked.results[c]);
          s.ranked.delivered[c] = true; await this.save();
        } catch { break; }
      }
    }
    if (s.match?.phase === 'matchover') {
      for (const st of s.seats) if (st?.profile) await this.profile(st.profile).release(s.id).catch(() => {});
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
