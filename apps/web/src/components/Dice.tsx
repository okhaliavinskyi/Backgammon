import { useEffect, useRef } from 'react';

/** Rotation that brings face `v` to the front. Faces: 1 front, 2 right, 3 top, 4 bottom, 5 left, 6 back. */
const FACE_ROT: Record<number, [number, number]> = {
  1: [0, 0],
  2: [0, -90],
  3: [-90, 0],
  4: [90, 0],
  5: [0, 90],
  6: [0, 180],
};

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[27, 27], [73, 73]],
  3: [[27, 27], [50, 50], [73, 73]],
  4: [[27, 27], [73, 27], [27, 73], [73, 73]],
  5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]],
  6: [[27, 25], [73, 25], [27, 50], [73, 50], [27, 75], [73, 75]],
};

const FACES: { v: number; tf: string }[] = [
  { v: 1, tf: 'rotateY(0deg)' },
  { v: 2, tf: 'rotateY(90deg)' },
  { v: 3, tf: 'rotateX(90deg)' },
  { v: 4, tf: 'rotateX(-90deg)' },
  { v: 5, tf: 'rotateY(-90deg)' },
  { v: 6, tf: 'rotateY(180deg)' },
];

export interface DieProps {
  value: number;
  /** Changes whenever a new roll should be animated. */
  rollKey: string | number;
  durationMs: number;
  used?: boolean;
  /** Throw direction: 1 from the right (viewer), -1 from the left (opponent). */
  dir?: 1 | -1;
  index?: number;
  dark?: boolean;
}

export function Die({ value, rollKey, durationMs, used, dir = 1, index = 0, dark }: DieProps) {
  const cube = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [rx, ry] = FACE_ROT[value] ?? [0, 0];
  const final = `rotateX(${rx}deg) rotateY(${ry}deg)`;

  useEffect(() => {
    const c = cube.current;
    const w = wrap.current;
    if (!c || !w || durationMs <= 0) return;
    const spinX = 360 * (2 + Math.floor(Math.random() * 2)) * (Math.random() < 0.5 ? -1 : 1);
    const spinY = 360 * (2 + Math.floor(Math.random() * 2)) * (Math.random() < 0.5 ? -1 : 1);
    const spinZ = (Math.random() * 2 - 1) * 180;
    const a1 = c.animate(
      [
        { transform: `rotateX(${rx + spinX}deg) rotateY(${ry + spinY}deg) rotateZ(${spinZ}deg)` },
        { transform: `rotateX(${rx + spinX * 0.25}deg) rotateY(${ry + spinY * 0.2}deg) rotateZ(${spinZ * 0.2}deg)`, offset: 0.7 },
        { transform: final },
      ],
      { duration: durationMs, easing: 'cubic-bezier(.2,.7,.25,1)' },
    );
    const fromX = dir * (160 + index * 30);
    const a2 = w.animate(
      [
        { transform: `translate(${fromX}%, ${-60 - index * 20}%) scale(1.25)`, opacity: 0.2 },
        { transform: `translate(${fromX * 0.15}%, 6%) scale(1.05)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${-dir * 4}%, -8%) scale(1.02)`, offset: 0.75 },
        { transform: 'translate(0,0) scale(1)' },
      ],
      { duration: durationMs, easing: 'cubic-bezier(.3,.8,.3,1)' },
    );
    return () => {
      a1.cancel();
      a2.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey]);

  return (
    <div ref={wrap} className={'die-wrap' + (used ? ' used' : '')}>
      <div ref={cube} className={'die' + (dark ? ' dark' : '')} style={{ transform: final }}>
        {FACES.map((f) => (
          <div key={f.v} className="face" style={{ transform: `${f.tf} translateZ(calc(var(--die) / 2))` }}>
            <svg viewBox="0 0 100 100">
              {PIPS[f.v].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={f.v === 1 ? 11 : 9.5} className={f.v === 1 ? 'pip one' : 'pip'} />
              ))}
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Leather dice cup that jiggles while the phone is being shaken. */
export function DiceCup({ shaking, impulse }: { shaking: boolean; impulse: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!impulse || !ref.current) return;
    const a = (Math.random() * 2 - 1) * 14;
    ref.current.animate(
      [
        { transform: 'rotate(0deg) translate(0,0)' },
        { transform: `rotate(${a}deg) translate(${a / 2}px, -6px)` },
        { transform: 'rotate(0deg) translate(0,0)' },
      ],
      { duration: 140, easing: 'ease-out' },
    );
  }, [impulse]);
  return (
    <svg ref={ref} className={'cup' + (shaking ? ' shaking' : '')} viewBox="0 0 120 140" aria-hidden>
      <defs>
        <linearGradient id="cupg" x1="0" x2="1">
          <stop offset="0" stopColor="#3b1a0b" />
          <stop offset="0.45" stopColor="#7b3b1a" />
          <stop offset="1" stopColor="#2c1207" />
        </linearGradient>
        <pattern id="stitch" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 5 H6" stroke="#e8c27a" strokeWidth="1.4" />
        </pattern>
      </defs>
      <path d="M18 18 L102 18 L92 130 Q60 138 28 130 Z" fill="url(#cupg)" stroke="#1e0b03" strokeWidth="2" />
      <ellipse cx="60" cy="18" rx="42" ry="9" fill="#1b0904" stroke="#c8963e" strokeWidth="3" />
      <rect x="22" y="40" width="76" height="3" fill="url(#stitch)" />
      <rect x="25" y="108" width="70" height="3" fill="url(#stitch)" />
      <path d="M30 60 Q60 52 90 60" stroke="#c8963e" strokeWidth="2" fill="none" opacity="0.6" />
    </svg>
  );
}

/** Doubling cube. */
export function Cube({ value }: { value: number }) {
  return (
    <div className="dcube" aria-label={`cube ${value}`}>
      {value === 1 ? 64 : value}
    </div>
  );
}
