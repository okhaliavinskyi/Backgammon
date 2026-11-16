import { gamePath } from '../lib/paths';
import { useEffect, useRef, useState } from 'react';
import { RemoteController, getToken } from '../controllers/remote';
import { useGame } from '../controllers/store';
import { useT } from '../lib/i18n';
import { useSettings } from '../lib/settings';
import { GameScreen } from './Game';
import { PageHead, type Nav } from './Menus';
import { Icon } from '../components/icons';

interface Info {
  exists: boolean;
  hasPassword?: boolean;
  seatsTaken?: number;
  seatsOffline?: number;
  offlineName?: string | null;
}

/** /r/:id — password prompt, waiting room with share link, then the game. */
export function RoomScreen({ id, nav }: { id: string; nav: Nav }) {
  const T = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState<string | null>(() => sessionStorage.getItem('nardy.pw.' + id));
  const [pwInput, setPwInput] = useState('');
  const [fatal, setFatal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ctrlRef = useRef<RemoteController | null>(null);
  const match = useGame((s) => s.match);
  const room = useGame((s) => s.room);

  useEffect(() => {
    fetch(gamePath(`/api/rooms/${id}`))
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ exists: false }));
  }, [id]);

  const hasToken = !!getToken(id);
  const full = !hasToken && info?.seatsTaken === 2;
  const noSeat = full && !info?.seatsOffline;
  const rejoin = full && !!info?.seatsOffline;
  const ready = info?.exists && !noSeat && (hasToken || (!info.hasPassword && !rejoin) || password !== null);
  const helloName = useSettings((s) => s.name) || (rejoin && info?.offlineName) || localStorage.getItem('nardy.name.' + id) || T.you;

  useEffect(() => {
    if (!ready || fatal) return;
    const c = new RemoteController(id, helloName, password ?? undefined, (code) => {
      if (code === 'bad_password') {
        sessionStorage.removeItem('nardy.pw.' + id);
        setPassword(null);
        setFatal('bad_password');
      } else setFatal(code);
    });
    ctrlRef.current = c;
    return () => {
      c.dispose();
      useGame.setState({ controller: null, match: null, room: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id, password, fatal]);

  const link = `${location.origin}${gamePath('/r/' + id)}`;

  if (info === null) return <div className="screen center">{T.connecting}</div>;
  if (!info.exists || noSeat || fatal === 'room_full' || fatal === 'room_expired' || fatal === 'room_gone') {
    return (
      <div className="screen center">
        <div className="empty-ico" aria-hidden><Icon name="people" size={48} /></div>
        <p>{noSeat || fatal === 'room_full' ? T.roomFull : T.roomNotFound}</p>
        <button className="btn" onClick={() => nav('/online')}>
          ← {T.back}
        </button>
      </div>
    );
  }
  if (rejoin && (!ready || fatal === 'bad_password')) {
    return <div className="screen form">
      <PageHead title={<>{T.rejoinAs} {info.offlineName}</>} onBack={() => nav('/online')} />
      {fatal === 'bad_password' && <p className="error">{T.badPassword}</p>}
      <form className="card pw-form" onSubmit={(e) => { e.preventDefault(); localStorage.setItem('nardy.name.' + id, helloName); setFatal(null); setPassword(info.hasPassword ? pwInput : ''); }}>
        {info.hasPassword && <label className="field">
          <span>{T.password}</span>
          <input type="password" autoFocus value={pwInput} onChange={(e) => setPwInput(e.target.value)} />
        </label>}
        <button className="btn primary big">{T.rejoin}</button>
      </form>
    </div>;
  }
  if (!ready || fatal === 'bad_password') {
    return (
      <div className="screen form">
        <PageHead title={<><Icon name="lock" /> {T.enterPassword}</>} onBack={() => nav('/online')} />
        {fatal === 'bad_password' && <p className="error">{T.badPassword}</p>}
        <form
          className="card pw-form"
          onSubmit={(e) => {
            e.preventDefault();
            setFatal(null);
            setPassword(pwInput);
          }}
        >
          <label className="field">
            <span>{T.password}</span>
            <input type="password" autoFocus value={pwInput} onChange={(e) => setPwInput(e.target.value)} />
          </label>
          <button className="btn primary big">{T.join}</button>
        </form>
      </div>
    );
  }

if (!match) {
  const s = room?.settings;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ url: link, title: T.appName });
      else await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch { /* cancelled */ }
  };
  return (
    <div className="screen form wait2">
      <PageHead title={T.waitingOpponent} onBack={() => nav('/online')} />
      <div className="code-card">
        <span className="muted">{T.roomCode}</span>
        <p className="code big-code" aria-label={id}>{[...id].map((ch, i) => <span key={i}>{ch}</span>)}</p>
        {s && <span className={'status-pill' + (s.isPublic ? ' ok' : '')}>{s.isPublic ? T.visibleInLobby : T.hiddenFromLobby}</span>}
      </div>
      <button className="btn primary big" onClick={share}><Icon name="share" /> {T.shareLink2}</button>
      <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* ignore */ } }}>
        <Icon name="copy" /> {copied ? T.copied : T.copyLink}
      </button>
      {s && (
        <dl className="params">
          <div><dt>{T.variant}</dt><dd>{s.variant === 'long' ? T.long : T.short}</dd></div>
          <div><dt>{T.matchLength}</dt><dd>{s.matchLength}</dd></div>
          <div><dt>{T.moveTimer}</dt><dd>{s.moveTimer ? `${s.moveTimer} ${T.sec}` : T.off}{s.bank ? ` + ${s.bank / 60} ${T.min}` : ''}</dd></div>
          <div><dt>{T.access}</dt><dd>{room?.hasPassword ? T.accessPassword : T.accessOpen}</dd></div>
        </dl>
      )}
      <button className="link leave" onClick={() => nav('/online')}>{T.leaveRoom}</button>
    </div>
  );
}


  return <GameScreen onExit={() => nav('/online')} />;
}
