import { THEMES, HINT_FILL_W, HINT_EDGE_W } from '../src/components/themes.ts';
const lum = (h: string) => { const n = parseInt(h.slice(1, 7), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const fails: string[] = []; let checked = 0;
for (const [name, th] of Object.entries(THEMES)) {
  for (const [bgName, bg] of Object.entries({ field: th.field, pointA: th.pointA, pointB: th.pointB, white: th.white.base, black: th.black.base })) {
    checked++;
    const best = Math.max(ratio(th.hint.fill, bg), ratio(th.hint.edge, bg));
    if (best < 3) fails.push(`${name}: hint vs ${bgName} ${bg} = ${best.toFixed(2)}`);
  }
}
let numberPairs = 0; let numberMin = Infinity;
for (const [name, th] of Object.entries(THEMES)) {
  for (const [bgName, bg] of Object.entries({ frame: th.frame, frameDark: th.frameDark })) {
    const contrast = ratio(th.number, bg); numberPairs++; numberMin = Math.min(numberMin, contrast);
    if (contrast < 4.5) fails.push(`${name}: point numbers vs ${bgName} = ${contrast.toFixed(2)}`);
  }
}
console.log(`point numbers checked ${numberPairs} pairs, minimum contrast ${numberMin.toFixed(2)}:1`);
const bandPx = ((HINT_EDGE_W - HINT_FILL_W) / 2) * (344 / 1000);
if (bandPx < 0.65) fails.push(`edge band ${bandPx.toFixed(2)} px at 360 < 0.65`);
console.log(`checked ${checked} pairs (expected 15), edge band ${bandPx.toFixed(2)} px`);
if (checked !== 15 || fails.length) { console.error(fails.join('\n')); process.exit(1); }
