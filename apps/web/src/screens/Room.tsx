import { useEffect, useRef, useState } from 'react';
import { RemoteController, getToken } from '../controllers/remote';
import { useGame } from '../controllers/store';
import { useT } from '../lib/i18n';
import { useSettings } from '../lib/settings';
import { GameScreen } from './Game';
import type { Nav } from './Menus';

interface Info {
  exists: boolean;
  hasPassword?: boolean;
  seatsTaken?: number;
}

/** /r/:id — password prompt, waiting room with share link, then the game. */
export function RoomScreen({ id, nav }: { id: string; nav: Nav }) {
  const T = useT();
  const name = useSettings((s) => s.name) || T.you;
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState<string | null>(() => sessionStorage.getItem('nardy.pw.' + id));
  const [pwInput, setPwInput] = useState('');
  const [fatal, setFatal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ctrlRef = useRef<RemoteController | null>(null);
  const match = useGame((s) => s.match);
  const room = useGame((s) => s.room);

  useEffect(() => {
    fetch(`/api/rooms/${id}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ exists: false }));
  }, [id]);

  const hasToken = !!getToken(id);
  const ready = info?.exists && (hasToken || !info.hasPassword || password !== null);

  useEffect(() => {
    if (!ready || fatal) return;
    const c = new RemoteController(id, name, password ?? undefined, (code) => {
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

  const link = `${location.origin}/r/${id}`;

  if (info === null) return <div className="screen center">{T.connecting}</div>;
  if (!info.exists || fatal === 'room_full' || fatal === 'room_expired' || fatal === 'room_gone') {
    return (
      <div className="screen center">
        <p>{fatal === 'room_full' ? T.roomFull : T.roomNotFound}</p>
        <button className="btn" onClick={() => nav('/online')}>
          ← {T.back}
        </button>
      </div>
    );
  }
  if (!ready || fatal === 'bad_password') {
    return (
      <div className="screen form">
        <button className="link" onClick={() => nav('/online')}>
          ← {T.back}
        </button>
        <h2>🔒 {T.enterPassword}</h2>
        {fatal === 'bad_password' && <p className="error">{T.badPassword}</p>}
        <form
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
    return (
      <div className="screen center waiting">
        <div className="spinner" aria-hidden>
          🎲
        </div>
        <h2>{T.waitingOpponent}</h2>
        <p>{T.shareLink}</p>
        <div className="share">
          <code>{link}</code>
          <button
            className="btn small"
            onClick={async () => {
              try {
                if (navigator.share) await navigator.share({ url: link, title: T.appName });
                else await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                /* cancelled */
              }
            }}
          >
            {copied ? T.copied : T.copy}
          </button>
        </div>
        <p className="code big-code">{id}</p>
        {room?.hasPassword && <p className="muted">🔒 {T.locked}</p>}
        <button className="link" onClick={() => nav('/online')}>
          ← {T.back}
        </button>
      </div>
    );
  }

  return <GameScreen onExit={() => nav('/online')} />;
}
