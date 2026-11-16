import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Lang } from './i18n';

export type Theme = 'wood' | 'minimal' | 'malachite' | 'night';
export type Speed = 'slow' | 'normal' | 'fast' | 'instant';

export interface Settings {
  name: string;
  lang: Lang;
  theme: Theme;
  sound: boolean;
  speed: Speed;
  autoRoll: boolean;
  autoConfirm: boolean;
  hints: boolean;
  shake: boolean;
  vibration: boolean;
  set: (patch: Partial<Omit<Settings, 'set'>>) => void;
}

function initialLang(): Lang {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'ru').toLowerCase();
  return /^(ru|uk|be|kk)/.test(l) ? 'ru' : 'en';
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      name: '',
      lang: initialLang(),
      theme: 'wood',
      sound: true,
      speed: 'normal',
      autoRoll: true,
      autoConfirm: true,
      hints: true,
      shake: true,
      vibration: true,
      set: (patch) => set(patch),
    }),
    {
      name: 'nardy.settings',
      version: 1,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<Settings>;
        return (version < 1 ? { ...s, autoRoll: true, autoConfirm: true } : s) as Settings;
      },
    },
  ),
);

/** Duration in ms of one checker move for the chosen speed. */
export function moveMs(speed: Speed): number {
  return { slow: 520, normal: 320, fast: 170, instant: 0 }[speed];
}

export function diceMs(speed: Speed): number {
  return { slow: 1300, normal: 900, fast: 550, instant: 0 }[speed];
}
