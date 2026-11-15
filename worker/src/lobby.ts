import { DurableObject } from 'cloudflare:workers';
import type { LobbyEntry } from '@nardy/core';
import type { Env } from './index';

const STALE_MS = 60 * 60 * 1000;
const MAX_LIST = 100;

/** Single global object holding the list of public rooms waiting for an opponent. */
export class LobbyDO extends DurableObject<Env> {
  async upsert(entry: LobbyEntry): Promise<void> {
    await this.ctx.storage.put('r:' + entry.id, { ...entry, updatedAt: Date.now() });
  }

  async remove(id: string): Promise<void> {
    await this.ctx.storage.delete('r:' + id);
  }

  async list(): Promise<LobbyEntry[]> {
    const all = await this.ctx.storage.list<LobbyEntry & { updatedAt: number }>({ prefix: 'r:' });
    const now = Date.now();
    const out: LobbyEntry[] = [];
    const stale: string[] = [];
    for (const [key, e] of all) {
      if (now - e.updatedAt > STALE_MS) stale.push(key);
      else out.push({ id: e.id, host: e.host, settings: e.settings, hasPassword: e.hasPassword, createdAt: e.createdAt });
    }
    if (stale.length) await this.ctx.storage.delete(stale);
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, MAX_LIST);
  }
}
