// Room credentials expire locally after 24 hours; server room expiry is independent.
const TTL = 24 * 60 * 60 * 1000;
export function pruneRoomData() {
  try {
    const ids = new Set(Object.keys(localStorage)
      .filter((key) => /^nardy\.(token|name|seen)\./.test(key))
      .map((key) => key.split('.').pop()!));
    for (const id of ids) {
      const at = Number(localStorage.getItem(`nardy.seen.${id}`));
      if (!at) { localStorage.setItem(`nardy.seen.${id}`, String(Date.now())); continue; }
      if (Date.now() - at > TTL) {
        for (const kind of ['token', 'name', 'seen']) localStorage.removeItem(`nardy.${kind}.${id}`);
      }
    }
    const saved = JSON.parse(localStorage.getItem('nardy.online') ?? 'null');
    if (saved && !localStorage.getItem(`nardy.token.${saved.id}`)) localStorage.removeItem('nardy.online');
  } catch { /* Storage may be disabled. */ }
}
export async function clearDeviceData(eraseProfile = false) {
  const response = await fetch(eraseProfile ? '/api/profile' : '/api/profile/device', { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
  if (!response.ok && !(eraseProfile && response.status === 401)) throw new Error('delete_failed');
  if (eraseProfile && response.status === 401) {
    const cleared = await fetch('/api/profile/device', { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
    if (!cleared.ok) throw new Error('delete_failed');
  }
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) if (key.startsWith('nardy.')) storage.removeItem(key);
  }
  if ('caches' in window) {
    for (const key of await caches.keys()) if (key.startsWith('nardy-')) await caches.delete(key);
  }
  if ('serviceWorker' in navigator) {
    for (const reg of await navigator.serviceWorker.getRegistrations()) {
      if (reg.active?.scriptURL === `${location.origin}/sw.js`) await reg.unregister();
    }
  }
  location.replace('/');
}

export async function downloadProfileData() {
  const response = await fetch('/api/profile/export', { signal: AbortSignal.timeout(10_000) });
  if (response.status === 401) throw new Error('no_profile');
  if (!response.ok) throw new Error('export_failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nardy-profile.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
