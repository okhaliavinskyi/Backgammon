import { initialRatings, updatedRating, type RankedTicket, type RatingEvent } from '@nardy/core';
import { DurableObject } from 'cloudflare:workers';
import { COSMETICS, ALL_COSMETICS, levelForXp, newProfile, type ProgressProfile, type ProgressEvent, type CosmeticKind } from '@nardy/core';
import { exportProfileRecords } from './profile-export';
import type { Env } from './index';

const PROFILE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** One object per anonymous secret ID. No public ID can authorize profile access. */
export class ProfileDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS data (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  private read<T>(key: string): T | undefined {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM data WHERE id = ?', key).toArray()[0];
    return row ? JSON.parse(row.value) as T : undefined;
  }
  private write(key: string, value: unknown) {
    this.ctx.storage.sql.exec('INSERT INTO data (id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  }
  async init(secret: string): Promise<ProgressProfile> {
    const profile = this.ctx.storage.transactionSync(() => {
      const p = this.getProfile() ?? newProfile();
      this.write('identity', secret);
      this.write('profile', p); return p;
    });
    await this.touch();
    return profile;
  }
  async touch(): Promise<void> {
    if (!this.getProfile()) return;
    const now = Date.now();
    this.write('lastUsed', now);
    await this.ctx.storage.setAlarm(now + PROFILE_TTL_MS);
  }
  async erase(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    // Keep the table schema available for a later legitimate init; record() cannot recreate a deleted profile.
    this.ctx.storage.sql.exec('DELETE FROM data');
  }
  override async alarm(): Promise<void> {
    const lastUsed = this.read<number>('lastUsed');
    if (!lastUsed || Date.now() >= lastUsed + PROFILE_TTL_MS) await this.erase();
    else await this.ctx.storage.setAlarm(lastUsed + PROFILE_TTL_MS);
  }
  exportData(): { email: string | null; version: number; profile: ProgressProfile | null; lastUsed: number | null; records: { category: string; reference: string; value: unknown }[] } {
    const rows = this.ctx.storage.sql.exec<{ id: string; value: string }>('SELECT id, value FROM data ORDER BY id').toArray();
    const records = exportProfileRecords(rows);
    return { email: this.linkedAccount()?.email ?? null, version: 1, profile: this.getProfile(), lastUsed: this.read<number>('lastUsed') ?? null, records };
  }
  getProfile(): ProgressProfile | null {
    const p = this.read<ProgressProfile>('profile');
    if (!p) return null;
    p.ratings ??= initialRatings(); return p;
  }
  guestAllowed(): boolean { return !!this.getProfile() && !this.read('account'); }
  linkedAccount(): { id: string; email: string } | null { return this.read<{ id: string; email: string }>('account') ?? null; }
  linkAccount(id: string, email: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      if (!this.getProfile()) return false;
      const linked=this.linkedAccount(); if(linked && linked.id!==id)return false;
      this.write('account',{id,email});return true;
    });
  }

  rankedTicket(): RankedTicket | null {
    const t = this.read<RankedTicket>('ranked');
    if (!t || (!t.room && t.expires <= Date.now())) return null;
    return t;
  }
  reserveRanked(key: string): RankedTicket | null {
    return this.ctx.storage.transactionSync(() => {
      if (!this.getProfile()) return null;
      const t = this.rankedTicket();
      if (t && (t.key !== key || t.room)) return t;
      const next = { id: t?.id ?? crypto.randomUUID(), key, room: null, expires: Date.now() + 45000 };
      this.write('ranked', next); return next;
    });
  }
  assignRanked(key: string, room: string, ticketId: string): boolean {
    return this.ctx.storage.transactionSync(() => {
      const t = this.rankedTicket();
      if (!t || t.id !== ticketId || t.key !== key || (t.room && t.room !== room)) return false;
      this.write('ranked', { id: t.id, key, room, expires: 0 }); return true;
    });
  }
  releaseRanked(key: string, ticketId?: string): void {
    const t = this.rankedTicket();
    if (t && (!ticketId || t.id === ticketId) && (t.room === key || (!t.room && t.key === key))) this.ctx.storage.sql.exec('DELETE FROM data WHERE id = ?', 'ranked');
  }
  rate(event: RatingEvent): boolean {
    return this.ctx.storage.transactionSync(() => {
      const p = this.getProfile(); if (!p) return true; // Never recreate erased profiles.
      if (this.read('rating:' + event.id)) return true;
      const ticket = this.rankedTicket();
      if (ticket?.room !== event.room) return true; // Deleted/recreated or cancelled identity.
      const current = p.ratings[event.variant];
      if (current.elo !== event.own.elo || current.matches !== event.own.matches) throw new Error('rating_snapshot_mismatch');
      p.ratings[event.variant] = updatedRating(event.own, event.opponent, event.won);
      this.write('profile', p);
      this.write('rating:' + event.id, { ...event, delta: p.ratings[event.variant].elo - current.elo, version: 1 });
      this.releaseRanked(event.room); return true;
    });
  }

  async acquire(room: string): Promise<boolean> {
    const previous = this.read<{ room: string; at: number }>('active');
    if (previous && previous.room !== room && Date.now() - previous.at < 35 * 60_000) {
      const secret = this.read<string>('identity');
      if (!secret) return false;
      try {
        if (await this.env.ROOM.get(this.env.ROOM.idFromName(previous.room)).profileConnected(secret)) return false;
      } catch { return false; }
    }
    return this.ctx.storage.transactionSync(() => {
      if (!this.getProfile()) return false;
      const active = this.read<{ room: string; at: number }>('active');
      // Another acquire may have completed during the old-room lookup.
      if (active && active.room !== room && (active.room !== previous?.room || active.at !== previous?.at)) return false;
      if (active && active.room !== room) this.write('lease:' + active.room, { until: Date.now() });
      this.write('lease:' + room, { until: null });
      this.write('active', { room, at: Date.now() }); return true;
    });
  }
  release(room: string): void {
    this.ctx.storage.transactionSync(() => {
      if (this.read<{ room: string }>('active')?.room === room) {
        this.write('lease:' + room, { until: Date.now() });
        this.ctx.storage.sql.exec('DELETE FROM data WHERE id = ?', 'active');
      }
    });
  }
  purchase(id: string): { profile?: ProgressProfile; error?: string } {
    return this.ctx.storage.transactionSync(() => {
      const p = this.getProfile(); const item = COSMETICS.find(x => x.id === id);
      if (!p || !item) return { error: 'not_found' };
      if (p.owned.includes(id)) return { profile: p };
      if (p.coins < item.price) return { error: 'not_enough_coins' };
      p.coins -= item.price; p.owned.push(id); this.write('purchase:' + id, { at: Date.now(), coins: -item.price, version: 1 }); this.write('profile', p); return { profile: p };
    });
  }
  equip(kind: CosmeticKind, id: string | null): { profile?: ProgressProfile; error?: string } {
    return this.ctx.storage.transactionSync(() => {
      const p = this.getProfile();
      if (!p || !['avatar', 'frame', 'dice', 'theme'].includes(kind)) return { error: 'not_found' };
      if (id !== null && (!p.owned.includes(id) || !ALL_COSMETICS.some(x => x.id === id && x.kind === kind))) return { error: 'not_owned' };
      if (id === null) delete p.equipped[kind]; else p.equipped[kind] = id;
      this.write('profile', p); return { profile: p };
    });
  }
  record(event: ProgressEvent): ProgressProfile | null {
    return this.ctx.storage.transactionSync(() => {
      const p = this.getProfile(); if (!p) return null;
      if (this.read('event:' + event.id)) return p;
      const stats = p.stats[event.variant]; stats.games++;
      if (event.matchWon !== null) { stats.matches++; if (event.matchWon) stats.wins++; else stats.losses++; }
      const pairKey = 'pair:' + event.opponent + ':' + event.variant;
      const pair = this.read<{ wins: number; losses: number }>(pairKey) ?? { wins: 0, losses: 0 };
      if (event.matchWon !== null) { if (event.matchWon) pair.wins++; else pair.losses++; this.write(pairKey, pair); }
      let xp = 0, coins = 0, limited = false;
      const lease = this.read<{ until: number | null }>('lease:' + event.room);
      const qualified = event.qualified && !!lease && (lease.until === null || event.at <= lease.until);
      if (qualified) {
        const day = new Date(event.at).toISOString().slice(0, 10);
        const counterKey = 'daily:' + day + ':' + event.opponent;
        const count = this.read<number>(counterKey) ?? 0;
        limited = count >= 10; this.write(counterKey, count + 1);
        xp = event.won ? 150 : 100; coins = limited ? 0 : event.won ? 30 : 20;
        if (!this.read('bonus:' + day)) { xp += 50; if (!limited) coins += 10; this.write('bonus:' + day, true); }
        if (!this.read('gift')) { coins += 100; this.write('gift', true); }
        const before = levelForXp(p.xp); p.xp += xp;
        for (let l = before + 1; l <= levelForXp(p.xp); l++) {
          coins += 20 + (l % 5 === 0 ? 80 : 0);
          if ([5, 10, 20, 30].includes(l)) p.owned.push('level-' + l);
        }
        stats.qualified++; if (event.won) stats.qualifiedWins++;
        const games = p.stats.long.qualified + p.stats.short.qualified;
        const wins = p.stats.long.qualifiedWins + p.stats.short.qualifiedWins;
        p.badges = [wins >= 1 && 'first-win', games >= 10 && 'games-10', wins >= 10 && 'wins-10', games >= 50 && 'games-50', wins >= 50 && 'wins-50', games >= 100 && 'games-100'].filter((x): x is string => typeof x === 'string');
      }
      p.coins += coins;
      p.lastReward = { event: event.id, xp, coins, limited, qualified, at: event.at };
      this.write('event:' + event.id, { at: event.at, xp, coins, version: 1 });
      this.write('profile', p); return p;
    });
  }
  pair(opponent: string, variant: string): { wins: number; losses: number } {
    return this.read('pair:' + opponent + ':' + variant) ?? { wins: 0, losses: 0 };
  }
}
