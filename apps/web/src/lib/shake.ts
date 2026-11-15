/**
 * Shake-to-roll using DeviceMotion. A "shake" is a series of acceleration
 * spikes; once the user stops shaking (calm for CALM_MS after at least
 * MIN_IMPULSES spikes) the dice are thrown.
 */
const THRESHOLD = 13; // m/s² change between samples
const MIN_IMPULSES = 3;
const CALM_MS = 380;
const IMPULSE_GAP_MS = 70;

type PermissionFn = () => Promise<'granted' | 'denied'>;

export function motionSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window && matchMedia('(pointer: coarse)').matches;
}

export function needsPermission(): boolean {
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent;
  return typeof DME?.requestPermission === 'function';
}

let granted = false;

/** Must be called from a click handler on iOS. */
export async function requestMotionPermission(): Promise<boolean> {
  if (granted) return true;
  const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: PermissionFn } }).DeviceMotionEvent;
  if (typeof DME?.requestPermission === 'function') {
    try {
      granted = (await DME.requestPermission()) === 'granted';
    } catch {
      granted = false;
    }
    return granted;
  }
  granted = true;
  return true;
}

export interface ShakeHandlers {
  onImpulse: (strength: number) => void;
  onShakeStart: () => void;
  onThrow: () => void;
}

export function listenShake(h: ShakeHandlers): () => void {
  let last: { x: number; y: number; z: number } | null = null;
  let impulses = 0;
  let lastImpulse = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity ?? e.acceleration;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const cur = { x: a.x, y: a.y, z: a.z };
    if (last) {
      const delta = Math.abs(cur.x - last.x) + Math.abs(cur.y - last.y) + Math.abs(cur.z - last.z);
      const now = performance.now();
      if (delta > THRESHOLD && now - lastImpulse > IMPULSE_GAP_MS) {
        lastImpulse = now;
        impulses++;
        if (impulses === 1) h.onShakeStart();
        h.onImpulse(Math.min(1.5, delta / 25));
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (impulses >= MIN_IMPULSES) h.onThrow();
          impulses = 0;
        }, CALM_MS);
      }
    }
    last = cur;
  };
  window.addEventListener('devicemotion', onMotion);
  return () => {
    window.removeEventListener('devicemotion', onMotion);
    if (timer) clearTimeout(timer);
  };
}
