import type { Theme } from '../lib/settings';

export const SELECT_GREEN = "#3ddc84"; // selected checker: distinct from per-theme movable hints
export const SELECT_DARK = "#06361b";
export const HINT_FILL_W = 4;
export const HINT_EDGE_W = 8;

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
  rim: { fill: string; edge: string };
  hint: { fill: string; edge: string };
  dim: number;
  highlight: string;
  target: string;
}

const BASE_THEMES: Record<Exclude<Theme, 'amber' | 'slate'>, BoardTheme> = {
  night: {
    frame: '#161718', frameDark: '#0b0c0d',
    field: '#202224', fieldTexture: 'none',
    pointA: '#34383b', pointB: '#4a4640', pointStroke: 'transparent',
    bar: '#101213', tray: '#101213', inlay: '#555047', number: '#aaa397',
    white: { base: '#aaa397', light: '#b9b1a3', dark: '#79746b', ring: '#5d5952' },
    black: { base: '#363c41', light: '#4b535a', dark: '#252a2e', ring: '#878d91' },
    rim: { fill: '#aaa397', edge: '#0b0c0d' },
    hint: { fill: '#99b3a0', edge: '#101a13' },
    dim: 0.86, highlight: '#b6a075', target: '#99b3a0',
  },
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
    rim: { fill: '#f6e5bf', edge: '#382015' },
    hint: { fill: '#fff1c2', edge: '#352315' },
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
    rim: { fill: '#dbe9f3', edge: '#0c1721' },
    hint: { fill: '#66d9c2', edge: '#10221f' },
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
    rim: { fill: '#f2d78b', edge: '#071f16' },
    hint: { fill: '#f3d17a', edge: '#0b2119' },
    dim: 0.82,
    highlight: '#ffe08a',
    target: '#9effc8',
  },
};

export const THEMES: Record<Theme, BoardTheme> = {
  ...BASE_THEMES,
  amber: { ...BASE_THEMES.wood, frame: '#69401d', frameDark: '#32200e', field: '#dfb86c', pointA: '#7d391b', pointB: '#fff0be', inlay: '#f3cc76', white: { base: '#fff3c9', light: '#fffbea', dark: '#c3a05b', ring: '#8e672d' } },
  slate: { ...BASE_THEMES.minimal, frame: '#273646', frameDark: '#14202d', field: '#596f7b', pointA: '#263644', pointB: '#bdced0', number: '#f3f7fa', black: { base: '#24313a', light: '#4d6470', dark: '#101b23', ring: '#93aab3' } },
};
