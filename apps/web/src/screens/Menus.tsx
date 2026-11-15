import { useEffect, useState } from 'react';
import { BANKS, LobbyEntry, MATCH_LENGTHS, MOVE_TIMERS, RoomSettings, DEFAULT_SETTINGS, type AiLevel, type Variant } from '@nardy/core';
import { useT } from '../lib/i18n';
import { Theme, useSettings, Speed } from '../lib/settings';
import { loadSavedAiGame } from '../controllers/local';
import { motionSupported, needsPermission, requestMotionPermission } from '../lib/shake';
import { unlockAudio } from '../lib/sound';
import { Logo } from '../components/Logo';

export type Nav = (path: string) => void;

function Seg<T extends string | number | boolean>({ value, options, onChange }: { value: T; options: { v: T; label: string; sub?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

function NameField() {
  const T = useT();
  const { name, set } = useSettings();
  return (
    <label className="field">
      <span>{T.yourName}</span>
      <input value={name} maxLength={20} onChange={(e) => set({ name: e.target.value })} placeholder={T.you} />
    </label>
  );
}

export function Home({ nav }: { nav: Nav }) {
  const T = useT();
  const saved = loadSavedAiGame();
  return (
    <div className="screen home">
      <Logo />
      <h1>{T.appName}</h1>
      <p className="tagline">{T.tagline}</p>
      <div className="menu">
        {saved && (
          <button className="btn gold big" onClick={() => nav('/play?resume=1')}>
            ▶ {T.continueGame}
          </button>
        )}
        <button className="btn primary big" onClick={() => (unlockAudio(), nav('/online'))}>
          🌐 {T.playOnline}
        </button>
        <button className="btn big" onClick={() => (unlockAudio(), nav('/ai'))}>
          🤖 {T.playAi}
        </button>
        <button className="btn big" onClick={() => (unlockAudio(), nav('/local'))}>
          👥 {T.playLocal}
        </button>
        <button className="btn subtle" onClick={() => nav('/settings')}>
          ⚙ {T.settings}
        </button>
      </div>
      <details className="rules">
        <summary>{T.rules}</summary>
        <h3>{T.long}</h3>
        <p>{T.rulesLong}</p>
        <h3>{T.short}</h3>
        <p>{T.rulesShort}</p>
      </details>
    </div>
  );
}

function VariantPicker({ value, onChange }: { value: Variant; onChange: (v: Variant) => void }) {
  const T = useT();
  return (
    <Seg
      value={value}
      onChange={onChange}
      options={[
        { v: 'long', label: T.long, sub: T.longDesc },
        { v: 'short', label: T.short, sub: T.shortDesc },
      ]}
    />
  );
}

export function GameSetup({ nav, mode }: { nav: Nav; mode: 'ai' | 'local' }) {
  const T = useT();
  const [variant, setVariant] = useState<Variant>('long');
  const [len, setLen] = useState(1);
  const [cube, setCube] = useState(true);
  const [level, setLevel] = useState<AiLevel>('amateur');
  return (
    <div className="screen form">
      <button className="link" onClick={() => nav('/')}>
        ← {T.back}
      </button>
      <h2>{mode === 'ai' ? T.playAi : T.playLocal}</h2>
      <NameField />
      <label className="field">
        <span>{T.variant}</span>
        <VariantPicker value={variant} onChange={setVariant} />
      </label>
      {mode === 'ai' && (
        <label className="field">
          <span>{T.aiLevel}</span>
          <Seg
            value={level}
            onChange={setLevel}
            options={[
              { v: 'beginner', label: T.beginner },
              { v: 'amateur', label: T.amateur },
              { v: 'master', label: T.master },
            ]}
          />
        </label>
      )}
      <label className="field">
        <span>{T.matchLength}</span>
        <Seg value={len} onChange={setLen} options={MATCH_LENGTHS.map((v) => ({ v, label: String(v) }))} />
      </label>
      {variant === 'short' && (
        <label className="check">
          <input type="checkbox" checked={cube} onChange={(e) => setCube(e.target.checked)} /> {T.cube}
        </label>
      )}
      <button className="btn primary big" onClick={() => nav(`/play?mode=${mode}&variant=${variant}&len=${len}&cube=${cube ? 1 : 0}&level=${level}`)}>
        {T.start}
      </button>
    </div>
  );
}

export function Online({ nav }: { nav: Nav }) {
  const T = useT();
  const [rooms, setRooms] = useState<LobbyEntry[] | null>(null);
  const [code, setCode] = useState('');
  const load = () =>
    fetch('/api/rooms')
      .then((r) => r.json())
      .then((d) => setRooms(d.rooms ?? []))
      .catch(() => setRooms([]));
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);
  const timerLabel = (s: RoomSettings) => {
    const parts: string[] = [];
    if (s.moveTimer) parts.push(`${s.moveTimer}${T.sec}`);
    if (s.bank) parts.push(`${s.bank / 60}${T.min}`);
    return parts.join(' + ') || '∞';
  };
  return (
    <div className="screen form">
      <button className="link" onClick={() => nav('/')}>
        ← {T.back}
      </button>
      <h2>{T.playOnline}</h2>
      <NameField />
      <div className="row">
        <button className="btn primary big grow" onClick={() => nav('/create')}>
          ＋ {T.createRoom}
        </button>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toUpperCase();
          if (/^[A-Z0-9]{6}$/.test(c)) nav('/r/' + c);
        }}
      >
        <input className="grow code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder={T.code} aria-label={T.code} />
        <button className="btn">{T.join}</button>
      </form>
      <div className="lobby-head">
        <h3>{T.lobby}</h3>
        <button className="link" onClick={load}>
          ↻ {T.refresh}
        </button>
      </div>
      <div className="lobby">
        {rooms === null && <p className="muted">…</p>}
        {rooms?.length === 0 && <p className="muted">{T.noRooms}</p>}
        {rooms?.map((r) => (
          <button key={r.id} className="room-card" onClick={() => nav('/r/' + r.id)}>
            <div>
              <b>{r.host}</b> {r.hasPassword && <span title={T.locked}>🔒</span>}
              <div className="muted">
                {r.settings.variant === 'long' ? T.long : T.short} · {T.matchLength} {r.settings.matchLength} · ⏱ {timerLabel(r.settings)}
                {r.settings.cube ? ' · ×2' : ''}
              </div>
            </div>
            <span className="code">{r.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CreateRoom({ nav }: { nav: Nav }) {
  const T = useT();
  const name = useSettings((s) => s.name);
  const [s, setS] = useState<RoomSettings>({ ...DEFAULT_SETTINGS });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const up = (patch: Partial<RoomSettings>) => setS((x) => ({ ...x, ...patch }));
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: s, password, name }) });
      if (!r.ok) throw new Error(String(r.status));
      const { id } = await r.json();
      if (password) sessionStorage.setItem('nardy.pw.' + id, password);
      nav('/r/' + id);
    } catch (e) {
      setErr(T.error + ': ' + (e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="screen form">
      <button className="link" onClick={() => nav('/online')}>
        ← {T.back}
      </button>
      <h2>{T.createRoom}</h2>
      <NameField />
      <label className="field">
        <span>{T.variant}</span>
        <VariantPicker value={s.variant} onChange={(variant) => up({ variant })} />
      </label>
      <label className="field">
        <span>{T.matchLength}</span>
        <Seg value={s.matchLength} onChange={(matchLength) => up({ matchLength })} options={MATCH_LENGTHS.map((v) => ({ v, label: String(v) }))} />
      </label>
      <label className="field">
        <span>{T.moveTimer}</span>
        <Seg value={s.moveTimer} onChange={(moveTimer) => up({ moveTimer })} options={MOVE_TIMERS.map((v) => ({ v, label: v ? `${v}${T.sec}` : T.off }))} />
      </label>
      <label className="field">
        <span>{T.bank}</span>
        <Seg value={s.bank} onChange={(bank) => up({ bank })} options={BANKS.map((v) => ({ v, label: v ? `${v / 60}${T.min}` : T.off }))} />
      </label>
      {s.variant === 'short' && (
        <label className="check">
          <input type="checkbox" checked={s.cube} onChange={(e) => up({ cube: e.target.checked })} /> {T.cube}
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={s.isPublic} onChange={(e) => up({ isPublic: e.target.checked })} /> {T.publicRoom}
      </label>
      <label className="field">
        <span>{T.passwordOptional}</span>
        <input type="password" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      {err && <p className="error">{err}</p>}
      <button className="btn primary big" disabled={busy} onClick={create}>
        {T.create}
      </button>
    </div>
  );
}

export function SettingsScreen({ nav }: { nav: Nav }) {
  const T = useT();
  const st = useSettings();
  const [motion, setMotion] = useState<boolean | null>(null);
  return (
    <div className="screen form">
      <button className="link" onClick={() => nav('/')}>
        ← {T.back}
      </button>
      <h2>{T.settings}</h2>
      <NameField />
      <label className="field">
        <span>{T.language}</span>
        <Seg value={st.lang} onChange={(lang) => st.set({ lang })} options={[{ v: 'ru', label: 'Русский' }, { v: 'en', label: 'English' }]} />
      </label>
      <label className="field">
        <span>{T.theme}</span>
        <Seg<Theme>
          value={st.theme}
          onChange={(theme) => st.set({ theme })}
          options={[
            { v: 'wood', label: T.themeWood },
            { v: 'minimal', label: T.themeMinimal },
            { v: 'malachite', label: T.themeMalachite },
          ]}
        />
      </label>
      <label className="field">
        <span>{T.animSpeed}</span>
        <Seg<Speed>
          value={st.speed}
          onChange={(speed) => st.set({ speed })}
          options={[
            { v: 'slow', label: T.slow },
            { v: 'normal', label: T.normal },
            { v: 'fast', label: T.fast },
            { v: 'instant', label: T.instant },
          ]}
        />
      </label>
      {(
        [
          ['sound', T.sound],
          ['autoRoll', T.autoRoll],
          ['autoConfirm', T.autoConfirm],
          ['hints', T.hints],
          ['shake', T.shakeToRoll],
          ['vibration', T.vibration],
        ] as const
      ).map(([k, label]) => (
        <label className="check" key={k}>
          <input type="checkbox" checked={st[k]} onChange={(e) => st.set({ [k]: e.target.checked })} /> {label}
        </label>
      ))}
      {motionSupported() && needsPermission() && (
        <button className="btn" onClick={async () => setMotion(await requestMotionPermission())}>
          📳 {T.enableShake} {motion === true ? '✓' : motion === false ? '✕' : ''}
        </button>
      )}
    </div>
  );
}
