import { ALL_COSMETICS } from '@nardy/core';
import { useProgress, loadProgress } from './lib/progress';
import { ProgressScreen } from './screens/Progress';
import { useEffect, useMemo, useState } from 'react';
import type { AiLevel, Variant } from '@nardy/core';
import { LocalController, clearSavedAiGame, loadSavedAiGame } from './controllers/local';
import { useGame } from './controllers/store';
import { useT } from './lib/i18n';
import { useSettings } from './lib/settings';
import { GameScreen } from './screens/Game';
import { CreateRoom, GameSetup, Home, Online, SettingsScreen } from './screens/Menus';
import { LegalPage } from './screens/Legal';
import { RoomScreen } from './screens/Room';

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const nav = (p: string) => {
    history.pushState(null, '', p);
    setPath(p);
    window.scrollTo(0, 0);
  };
  return [path, nav];
}

function LocalGame({ query, nav }: { query: URLSearchParams; nav: (p: string) => void }) {
  const T = useT();
  const name = useSettings((s) => s.name) || T.you;
  const match = useGame((s) => s.match);
  const key = query.toString();
  useEffect(() => {
    let ctrl: LocalController;
    const saved = query.get('resume') ? loadSavedAiGame() : null;
    if (saved) {
      ctrl = new LocalController({ mode: 'ai', settings: saved.match.settings, level: saved.level, names: saved.names, resume: saved.match });
    } else {
      const mode = query.get('mode') === 'local' ? 'local' : 'ai';
      const variant = (query.get('variant') === 'short' ? 'short' : 'long') as Variant;
      const level = (['beginner', 'amateur', 'master'].includes(query.get('level') ?? '') ? query.get('level') : 'amateur') as AiLevel;
      if (mode === 'ai') clearSavedAiGame();
      ctrl = new LocalController({
        mode,
        level,
        settings: { variant, matchLength: Number(query.get('len')) || 1, cube: query.get('cube') === '1' },
        names: mode === 'ai' ? [name, T[level]] : [`${name} (${T.white})`, T.black],
      });
    }
    return () => {
      ctrl.dispose();
      useGame.setState({ controller: null, match: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!match) return null;
  return <GameScreen onExit={() => nav('/')} />;
}

export function App() {
  const [path, nav] = usePath();
  const baseTheme = useSettings((s) => s.theme);
  const equipped = useProgress(s => s.profile?.equipped);
  const theme = ALL_COSMETICS.find(x => x.id === equipped?.theme)?.value ?? baseTheme;
  const dice = ALL_COSMETICS.find(x => x.id === equipped?.dice)?.value ?? '';
  useEffect(() => { void loadProgress(); }, []);
  const lang = useSettings((s) => s.lang);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
    document.documentElement.dataset.dice = dice;
  }, [theme, lang, dice]);

  const [pathname, search] = useMemo(() => {
    const [p, q = ''] = path.split('?');
    return [p, new URLSearchParams(q)];
  }, [path]);

  const room = pathname.match(/^\/r\/([A-Za-z0-9]{6})$/);
  if (room) return <RoomScreen key={room[1]} id={room[1].toUpperCase()} nav={nav} />;
  switch (pathname) {
    case '/profile': return <ProgressScreen nav={nav} />;
    case '/privacy': return <LegalPage page="privacy" />;
    case '/terms': return <LegalPage page="terms" />;
    case '/legal': return <LegalPage page="legal" />;
    case '/online':
      return <Online nav={nav} />;
    case '/create':
      return <CreateRoom nav={nav} />;
    case '/ai':
      return <GameSetup nav={nav} mode="ai" />;
    case '/local':
      return <GameSetup nav={nav} mode="local" />;
    case '/settings':
      return <SettingsScreen nav={nav} />;
    case '/play':
      return <LocalGame query={search} nav={nav} />;
    default:
      return <Home nav={nav} />;
  }
}
