import { pendingResolution } from './ranked-policy';
import { DurableObject } from 'cloudflare:workers';
import { matchingRange, type Rating, type SearchStatus, type Variant } from '@nardy/core';
import type { Env } from './index';
import { randomId } from './util';
interface Entry { ticket: string; profile: string; name: string; rating: Rating; since: number; seen: number }
interface Pending { room: string; variant: Variant; players: [Entry, Entry]; at: number }
interface State { variant?: Variant; entries: Entry[]; pending: Pending[] }
/** One coordination atom per variant. Profile tickets prevent cross-pool double entry. */
export class MatchmakingDO extends DurableObject<Env> {
  private state: State = { entries: [], pending: [] };
  private chain: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.state = await ctx.storage.get<State>('queue') ?? this.state; });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work); this.chain = result.catch(() => {}); return result;
  }
  private profile(id: string) { return this.env.PROFILE.get(this.env.PROFILE.idFromName(id)); }
  private room(id: string) { return this.env.ROOM.get(this.env.ROOM.idFromName(id)); }
  private async save() {
    await this.ctx.storage.put('queue', this.state);
    if (this.state.entries.length || this.state.pending.length) await this.ctx.storage.setAlarm(Date.now() + 5000);
    else await this.ctx.storage.deleteAlarm();
  }
  request(profile: string, variant: Variant, action: 'join' | 'status' | 'cancel', name: string): Promise<SearchStatus> {
    return this.serial(async () => {
      this.state.variant ??= variant;
      await this.reconcile();
      const key = 'queue:' + variant, stub = this.profile(profile);
      let ticket = await stub.rankedTicket();
      if (ticket?.room) return { status: 'matched', room: ticket.room };
      if (action === 'cancel') {
        this.state.entries = this.state.entries.filter(e => e.profile !== profile);
        await stub.releaseRanked(key); await this.save(); return { status: 'idle' };
      }
      if (ticket && ticket.key !== key) return { status: 'busy' };
      let entry = this.state.entries.find(e => e.profile === profile);
      if (action === 'join' || entry) {
        ticket = await stub.reserveRanked(key);
        if (!ticket || ticket.key !== key || ticket.room) return ticket?.room ? { status: 'matched', room: ticket.room } : { status: 'busy' };
        const p = await stub.getProfile(); if (!p) return { status: 'idle' };
        if (!entry) { entry = { ticket: ticket.id, profile, name, rating: p.ratings[variant], since: Date.now(), seen: Date.now() }; this.state.entries.push(entry); }
        else { entry.seen = Date.now(); entry.name = name || entry.name; }
        await this.save(); await this.pair(variant); await this.reconcile();
      }
      ticket = await stub.rankedTicket();
      if (ticket?.room) return { status: 'matched', room: ticket.room };
      return entry && this.state.entries.includes(entry) ? { status: 'searching', since: entry.since } : { status: 'idle' };
    });
  }
  private async pair(variant: Variant) {
    const now = Date.now();
    for (const a of [...this.state.entries].sort((a,b) => a.since - b.since)) {
      if (!this.state.entries.includes(a)) continue;
      const candidates = this.state.entries.filter(b => b !== a && Math.abs(b.rating.elo - a.rating.elo) <= Math.max(matchingRange(now - a.since), matchingRange(now - b.since)));
      const b = candidates.sort((x,y) => Math.abs(x.rating.elo - a.rating.elo) - Math.abs(y.rating.elo - a.rating.elo) || x.since - y.since)[0];
      if (!b) continue;
      this.state.pending.push({ room: randomId(), variant, players: [a,b], at: now });
      this.state.entries = this.state.entries.filter(e => e !== a && e !== b);
      await this.save();
    }
  }
  private async reconcile() {
    const now = Date.now();
    for (const e of [...this.state.entries]) {
      const ticket = await this.profile(e.profile).rankedTicket();
      if (now - e.seen > 30000 || !ticket || ticket.room || ticket.key !== 'queue:' + this.state.variant || ticket.id !== e.ticket) {
        this.state.entries = this.state.entries.filter(x => x !== e);
        if (!ticket?.room && ticket?.key === 'queue:' + this.state.variant) await this.profile(e.profile).releaseRanked(ticket.key, e.ticket);
      }
    }
    for (const item of [...this.state.pending]) {
      const room = this.room(item.room);
      const ok = await room.initRanked(item.room, item.variant, item.players.map(p => ({ profile: p.profile, name: p.name, rating: p.rating })) as [{ profile: string; name: string; rating: Rating }, { profile: string; name: string; rating: Rating }]);
      if (!ok) { // An ordinary room won a random-ID collision: persist a fresh ID before retry.
        item.room = randomId(); await this.save(); continue;
      }
      const lifecycle = await room.rankedLifecycle();
      const resolution = pendingResolution(lifecycle, now - item.at);
      if (resolution === 'assign') {
        const assignments = await Promise.all(item.players.map(p => this.profile(p.profile).assignRanked('queue:' + item.variant, item.room, p.ticket)));
        if (assignments.every(Boolean)) await room.activateRanked();
        else await room.cancelRanked();
      } else if (resolution === 'cancel') await room.cancelRanked();
      // Never release reservations of an activated match, even after a lost activation ack.
      const final = await room.rankedLifecycle();
      if (final.cancelled) for (const p of item.players) {
        await this.profile(p.profile).releaseRanked(item.room, p.ticket);
        await this.profile(p.profile).releaseRanked('queue:' + item.variant, p.ticket);
      }
      this.state.pending = this.state.pending.filter(x => x !== item); await this.save();
    }
    await this.save();
  }
  override async alarm(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + 5000);
    await this.serial(async () => {
      await this.reconcile();
      if (this.state.entries.length && this.state.variant) await this.pair(this.state.variant);
      await this.reconcile();
    });
  }
}
