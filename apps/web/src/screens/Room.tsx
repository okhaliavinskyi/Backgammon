import { PrivacyNotice } from './Legal';
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
  ranked?: boolean;
  cancelled?: boolean;
  hasPassword?: boolean;
  seatsTaken?: number;
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

  const savedName = useSettings((s) => s.name);
  const [nameInput, setNameInput] = useState('');
  const hasToken = !!getToken(id);
  const noSeat = !info?.ranked && !hasToken && info?.seatsTaken === 2;
  const ready = !!savedName.trim() && info?.exists && !noSeat && (hasToken || !info.hasPassword || password !== null);
  const helloName = useSettings((s) => s.name) || T.you;

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

  if (info?.cancelled || room?.ranked?.cancelled || fatal === 'match_cancelled' || fatal === 'not_invited') return <div className="screen form"><p>{useSettings.getState().lang === 'ru' ? 'Рейтинговый матч отменён или предназначен другим участникам. Elo не изменён, если матч не начался.' : 'Ranked match cancelled or reserved for other players. Unstarted matches do not affect Elo.'}</p><button className="btn primary" onClick={() => nav('/ranked')}>{useSettings.getState().lang === 'ru' ? 'К подбору' : 'Matchmaking'}</button></div>;

  if(fatal==='session_expired')return <div className="screen form"><p>{useSettings.getState().lang==='ru'?'Сессия изменилась или истекла. Войдите в сохранённый профиль для восстановления доступа.':'Your session changed or expired. Sign in to your saved profile to restore access.'}</p><button className="btn primary" onClick={()=>nav('/profile')}>{useSettings.getState().lang==='ru'?'Профиль / вход':'Profile / sign in'}</button><button className="btn" onClick={()=>location.reload()}>{useSettings.getState().lang==='ru'?'Обновить':'Reload'}</button></div>;

  if (fatal === 'rate_limited') return <div className="screen center"><p>{useSettings.getState().lang === 'ru' ? 'Слишком много попыток. Подождите минуту и попробуйте снова.' : 'Too many attempts. Wait a minute and try again.'}</p><button className="btn" onClick={() => nav('/online')}>{T.back}</button></div>;

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
  if (!savedName.trim()) return <div className="screen form">
    <PageHead title={T.yourName} onBack={() => nav('/online')} />
    <PrivacyNotice />
    <form className="card pw-form" onSubmit={e => { e.preventDefault(); if (nameInput.trim()) useSettings.getState().set({ name: nameInput.trim().slice(0, 20) }); }}>
      <label className="field"><span>{T.yourName}</span><input autoFocus maxLength={20} value={nameInput} onChange={e => setNameInput(e.target.value)} required /></label>
      <button className="btn primary big" disabled={!nameInput.trim()}>{T.join}</button>
    </form>
  </div>;
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

if (!match && info.ranked) return <div className="screen form"><PageHead title={useSettings.getState().lang === 'ru' ? 'Соперник найден' : 'Opponent found'} onBack={() => nav('/')} /><p>{useSettings.getState().lang === 'ru' ? 'Ожидаем подключения обоих игроков. Если соперник не появится за минуту, матч отменится без изменения рейтинга.' : 'Waiting for both players. If your opponent does not connect within a minute, the match is cancelled without affecting ratings.'}</p></div>;

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
      <PrivacyNotice />
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


  return <GameScreen onExit={() => nav(info.ranked ? '/ranked' : '/online')} />;
}
