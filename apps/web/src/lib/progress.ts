import { gamePath } from './paths';
import { create } from 'zustand';
import type { CosmeticKind, ProgressProfile } from '@nardy/core';
export const useProgress = create<{ profile: ProgressProfile | null; error: boolean; pair: { wins: number; losses: number } | null }>(() => ({ profile: null, error: false, pair: null }));
let pending: Promise<void> | null = null;
export async function loadProgress(create = false): Promise<void> {
  if (pending) { await pending; if (!create || useProgress.getState().profile) return; }
  pending = (async () => {
    try {
      const r = await fetch(gamePath('/api/profile'), { method: create ? 'POST' : 'GET', signal: AbortSignal.timeout(4000) });
      if (r.status === 401) { useProgress.setState({ profile: null, error: false }); return; }
      if (!r.ok) throw new Error('profile');
      const { profile } = await r.json(); useProgress.setState({ profile, error: false });
    } catch { useProgress.setState({ error: true }); }
  })().finally(() => { pending = null; });
  return pending;
}
export async function updateProgress(action: 'purchase' | 'equip', body: { id: string | null; kind?: CosmeticKind }): Promise<void> {
  const r = await fetch(gamePath('/api/profile/' + action), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? 'offline');
  useProgress.setState({ profile: data.profile });
}
