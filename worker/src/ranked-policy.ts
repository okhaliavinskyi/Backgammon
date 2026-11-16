import { CLAIM_AFTER_MS, type Color } from '@nardy/core';

/** An activation acknowledged by the room is irrevocable even if the queue's ack was lost. */
export function pendingResolution(room: { ready: boolean; cancelled: boolean }, age: number): 'committed' | 'assign' | 'cancel' {
  if (room.cancelled) return 'cancel';
  if (room.ready) return 'committed';
  return age < 45000 ? 'assign' : 'cancel';
}

/** Delayed alarms/reconnects must honor the first deadline, rather than handler ordering. */
export function firstRankedDeadline(now: number, clock: { player: Color; at: number } | null, disconnectedAt: [number | null, number | null]): { player: Color; at: number } | null {
  const candidates = clock ? [clock] : [];
  for (const player of [0,1] as const) {
    if (disconnectedAt[player] !== null) candidates.push({ player, at: disconnectedAt[player]! + CLAIM_AFTER_MS });
  }
  return candidates.filter(c => c.at <= now).sort((a,b) => a.at - b.at || a.player - b.player)[0] ?? null;
}
