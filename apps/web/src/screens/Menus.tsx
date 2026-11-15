import { useEffect, useState, type ReactNode } from 'react';
import { BANKS, LobbyEntry, MATCH_LENGTHS, MOVE_TIMERS, RoomSettings, DEFAULT_SETTINGS, type AiLevel, type Variant } from '@nardy/core';
import { useT } from '../lib/i18n';
import { Theme, useSettings, Speed } from '../lib/settings';
import { loadSavedAiGame } from '../controllers/local';
import { motionSupported, needsPermission, requestMotionPermission } from '../lib/shake';
import { unlockAudio } from '../lib/sound';
import { Logo } from '../components/Logo';
import { Icon } from '../components/icons';
import './menus.css';

export type Nav = (path: string) => void;

function Seg<T extends string | number | boolean>({ value, options, onChange, className = '' }: { className?: string; value: T; options: { v: T; label: string; sub?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className={'seg ' + className} role="radiogroup">
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ title, onBack }: { title: ReactNode; onBack: () => void }) {
  const T = useT();
  return (
    <header className="page-head">
      <button className="back" onClick={onBack}>
        <span aria-hidden>←</span> {T.back}
      </button>
      <h2>{title}</h2>
    </header>
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

export function NameChip() {
  const T = useT();
  const { name, set } = useSettings();
  const [edit, setEdit] = useState(false);
  if (edit)
    return <input className="name-input" autoFocus value={name} maxLength={20} placeholder={T.you} aria-label={T.yourName}
      onChange={(e) => set({ name: e.target.value })} onBlur={() => setEdit(false)} onKeyDown={(e) => e.key === 'Enter' && setEdit(false)} />;
  return (
    <button className="name-chip" onClick={() => setEdit(true)}>
      <span className="muted">{T.playingAs}</span> <b>{name || T.you}</b> <Icon name="edit" size={14} />
    </button>
  );
}


export function Home({ nav }: { nav: Nav }) {
  const T = useT();
  const saved = loadSavedAiGame();
  return (
<div className="screen home2">
  <header className="home2-head">
    <span className="home2-brand"><Logo size={36} /><b>{T.appName}</b></span>
    <button className="icon-btn t44" aria-label={T.settings} onClick={() => nav('/settings')}><Icon name="gear" /></button>
  </header>
  {saved && (
    <button className="resume-card" onClick={() => nav('/play?resume=1')}>
      <span className="resume-play" aria-hidden><Icon name="chevron" /></span>
      <span className="grow"><b>{T.continueGame}</b></span>
    </button>
  )}
  <div className="eyebrow">{T.newGame}</div>
  <button className="menu-row primary" onClick={() => (unlockAudio(), nav('/online'))}><Icon name="globe" size={26} /><span className="grow"><b>{T.playOnline}</b></span><Icon name="chevron" /></button>
  <button className="menu-row" onClick={() => (unlockAudio(), nav('/ai'))}><Icon name="robot" size={26} /><span className="grow"><b>{T.playAi}</b></span><Icon name="chevron" /></button>
  <button className="menu-row" onClick={() => (unlockAudio(), nav('/local'))}><Icon name="people" size={26} /><span className="grow"><b>{T.playLocal}</b></span><Icon name="chevron" /></button>
  <details className="rules home2-rules">
    <summary><Icon name="book" /> {T.howToPlay}</summary>
    <h3>{T.long}</h3><p>{T.rulesLong}</p><h3>{T.short}</h3><p>{T.rulesShort}</p>
  </details>
</div>

  );
}

function VariantPicker({ value, onChange }: { value: Variant; onChange: (v: Variant) => void }) {
  const T = useT();
  const opts: { v: Variant; label: string; sub: string }[] = [{ v: 'long', label: T.long, sub: T.longDesc }, { v: 'short', label: T.short, sub: T.shortDesc }];
  return (
    <div className="variant-cards" role="radiogroup" aria-label={T.variant}>
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={o.v === value} className={'variant-card' + (o.v === value ? ' on' : '')} onClick={() => onChange(o.v)}>
          <b>{o.label}</b><span>{o.sub}</span>
        </button>
      ))}
    </div>
  );
}


export function GameSetup({ nav, mode }: { nav: Nav; mode: 'ai' | 'local' }) {
  const T = useT();
  const [variant, setVariant] = useState<Variant>('long');
  const [len, setLen] = useState(1);
  const [cube, setCube] = useState(true);
  const [level, setLevel] = useState<AiLevel>('amateur');
  return (
<div className="screen form setup2">
  <PageHead title={mode === 'ai' ? T.playAi : T.playLocal} onBack={() => nav('/')} />
  <NameChip />
  <div className="eyebrow">{T.variant}</div>
  <VariantPicker value={variant} onChange={setVariant} />
  <label className={'check switch-row' + (variant === 'short' ? '' : ' off')}>
    <span className="grow">{T.cube}{variant !== 'short' && <small> · {T.cubeOnlyShort}</small>}</span>
    <input type="checkbox" role="switch" checked={variant === 'short' && cube} disabled={variant !== 'short'} onChange={(e) => setCube(e.target.checked)} />
  </label>
  {mode === 'ai' && (<>
    <div className="eyebrow">{T.aiLevel}</div>
    <Seg value={level} onChange={setLevel} options={[{ v: 'beginner', label: T.beginner }, { v: 'amateur', label: T.amateur }, { v: 'master', label: T.master }]} />
    <p className="muted hint">{T.botLevelHint}</p>
  </>)}
  <div className="eyebrow">{T.matchLength}</div>
  <Seg value={len} onChange={setLen} options={MATCH_LENGTHS.map((v) => ({ v, label: String(v) }))} />
  <div className="bottom-bar">
    <button className="btn primary big" onClick={() => nav(`/play?mode=${mode}&variant=${variant}&len=${len}&cube=${variant === 'short' && cube ? 1 : 0}&level=${level}`)}>
      {T.startWith} · {variant === 'long' ? T.long : T.short} · {T.matchLength} {len}
    </button>
  </div>
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
  const [filter, setFilter] = useState<'all' | Variant>('all');
const shown = rooms?.filter((r) => filter === 'all' || r.settings.variant === filter);
const chips = (s: RoomSettings) => [
  s.variant === 'long' ? T.long : T.short,
  `${T.matchLength} ${s.matchLength}`,
  s.moveTimer || s.bank ? [s.moveTimer && `${s.moveTimer} ${T.sec}`, s.bank && `${s.bank / 60} ${T.min}`].filter(Boolean).join(' + ') : '∞',
  ...(s.cube ? [T.cube] : []),
];

  return (
<div className="screen form online2">
  <PageHead title={T.playOnline} onBack={() => nav('/')} />
  <NameChip />
  <button className="btn primary big" onClick={() => nav('/create')}><Icon name="plus" /> {T.createRoom}</button>
  <div className="lobby-tools">
    <Seg className="lobby-filter" value={filter} onChange={setFilter}
      options={[{ v: 'all', label: T.filterAll }, { v: 'long', label: T.filterLong }, { v: 'short', label: T.filterShort }]} />
    <button className="icon-btn t44" aria-label={T.refresh} onClick={load}><Icon name="refresh" /></button>
  </div>
  <div className="eyebrow">{T.lobby} · {shown?.length ?? 0}</div>
  {rooms === null && <p className="muted">…</p>}
  {shown?.length === 0 && <p className="muted empty-text">{T.noRooms}</p>}
  {shown?.map((r) => (
    <button key={r.id} className="room-card2" onClick={() => nav('/r/' + r.id)}>
      <span className="avatar" aria-hidden>{r.host.charAt(0).toUpperCase()}</span>
      <span className="room-main">
        <span className="room-host"><b>{r.host}</b>{r.hasPassword && <span className="lock-chip"><Icon name="lock" size={12} /> {T.byPassword}</span>}</span>
        <span className="chips">{chips(r.settings).map((c) => <span key={c} className="chip">{c}</span>)}</span>
      </span>
      <span className="room-enter">{T.enter}</span>
    </button>
  ))}
  <div className="lobby-bar">
    <form onSubmit={(e) => { e.preventDefault(); const c = code.trim().toUpperCase(); if (/^[A-Z0-9]{6}$/.test(c)) nav('/r/' + c); }}>
      <label htmlFor="room-code" className="muted">{T.haveCode}</label>
      <input id="room-code" className="grow code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" />
      <button className="btn">{T.enter}</button>
    </form>
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
      <PageHead title={T.createRoom} onBack={() => nav('/online')} />
      <div className="card">
        <NameField />
      </div>
      <div className="card">
      <div className="field">
        <span>{T.variant}</span>
        <VariantPicker value={s.variant} onChange={(variant) => up({ variant })} />
      </div>
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
      </div>
      <div className="card toggles">
      {s.variant === 'short' && (
        <label className="check">
          <input type="checkbox" checked={s.cube} onChange={(e) => up({ cube: e.target.checked })} /> {T.cube}
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={s.isPublic} onChange={(e) => up({ isPublic: e.target.checked })} /> {T.publicRoom}
      </label>
      </div>
      <div className="card">
      <label className="field">
        <span>{T.passwordOptional}</span>
        <input type="password" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      </div>
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
      <PageHead title={T.settings} onBack={() => nav('/')} />
      <div className="card">
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
          className="seg-2col"
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
      </div>
      <div className="card toggles">
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
      </div>
      {motionSupported() && needsPermission() && (
        <button className="btn" onClick={async () => setMotion(await requestMotionPermission())}>
          📳 {T.enableShake} {motion === true ? '✓' : motion === false ? '✕' : ''}
        </button>
      )}
    </div>
  );
}
