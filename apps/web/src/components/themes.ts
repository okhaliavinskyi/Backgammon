import type { Theme } from '../lib/settings';

export const HINT_FILL_W = 3;
export const HINT_EDGE_W = 7;

export interface BoardTheme {
  frame: string;
  frameDark: string;
  field: string;
  fieldTexture: 'wood' | 'none' | 'malachite' | 'felt';
  pointA: string;
  pointB: string;
  pointStroke: string;
  bar: string;
  tray: string;
  inlay: string;
  number: string;
  white: { base: string; light: string; dark: string; ring: string };
  black: { base: string; light: string; dark: string; ring: string };
  hint: { fill: string; edge: string };
  dim: number;
  highlight: string;
  target: string;
}

export const THEMES: Record<Theme, BoardTheme> = {
  wood: {
    frame: '#5a2f17',
    frameDark: '#3a1d0d',
    field: '#d9b07a',
    fieldTexture: 'wood',
    pointA: '#8e2f22',
    pointB: '#f2e2c0',
    pointStroke: 'rgba(60,30,10,.35)',
    bar: '#4a2412',
    tray: '#3b1c0c',
    inlay: '#c99a4b',
    number: '#fff0ce',
    white: { base: '#f4ead2', light: '#fffaf0', dark: '#c9b78f', ring: '#b49a6a' },
    black: { base: '#2a1b14', light: '#5a4032', dark: '#120a06', ring: '#7a5a3a' },
    hint: { fill: '#d8bc83', edge: '#302219' },
    dim: 0.82,
    highlight: '#ffd34d',
    target: '#7dff9a',
  },
  minimal: {
    frame: '#1d2330',
    frameDark: '#141924',
    field: '#262d3b',
    fieldTexture: 'none',
    pointA: '#3d4a63',
    pointB: '#556482',
    pointStroke: 'transparent',
    bar: '#181d28',
    tray: '#171c27',
    inlay: '#3b465c',
    number: '#e2e7ef',
    white: { base: '#eef1f6', light: '#ffffff', dark: '#c3cad6', ring: '#a9b2c2' },
    black: { base: '#ff6b5a', light: '#ff9585', dark: '#d1453a', ring: '#b8382f' },
    hint: { fill: '#a7c9c0', edge: '#14221f' },
    dim: 0.82,
    highlight: '#ffd166',
    target: '#4ce0b3',
  },
  malachite: {
    frame: '#8a6a2b',
    frameDark: '#5e4614',
    field: '#0f5e46',
    fieldTexture: 'malachite',
    pointA: '#e9dfc4',
    pointB: '#06362a',
    pointStroke: 'rgba(212,175,55,.55)',
    bar: '#6d521d',
    tray: '#4d3a12',
    inlay: '#e2c26a',
    number: '#fff9e8',
    white: { base: '#efe8da', light: '#ffffff', dark: '#c8bba1', ring: '#d4af37' },
    black: { base: '#1c1f22', light: '#4a5056', dark: '#050607', ring: '#d4af37' },
    hint: { fill: '#d1c493', edge: '#10261d' },
    dim: 0.82,
    highlight: '#ffe08a',
    target: '#9effc8',
  },
};
