import { useEffect, useState } from 'react';
import { useSettings } from '../lib/settings';

export function FullscreenButton({ onToggle }: { onToggle?: () => void }) {
  const ru = useSettings(s => s.lang) === 'ru';
  const activeNow = () => !!document.fullscreenElement || document.documentElement.hasAttribute('data-viewport-fullscreen');
  const [active, setActive] = useState(activeNow);
  useEffect(() => {
    const update = () => setActive(activeNow());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('viewportfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('viewportfullscreenchange', update);
    };
  }, []);
  const toggle = async () => {
    const root = document.documentElement;
    onToggle?.();
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (root.hasAttribute('data-viewport-fullscreen')) root.removeAttribute('data-viewport-fullscreen');
    else {
      try {
        if (!document.fullscreenEnabled || !root.requestFullscreen) throw new Error('viewport fallback');
        await root.requestFullscreen();
      } catch { root.setAttribute('data-viewport-fullscreen', ''); }
    }
    document.dispatchEvent(new Event('viewportfullscreenchange'));
  };
  return <button className="btn fullscreen-button" type="button" onClick={() => void toggle()} aria-pressed={active}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg>
    {active ? (ru ? 'Выйти из полного экрана' : 'Exit fullscreen') : (ru ? 'На весь экран' : 'Fullscreen')}
  </button>;
}
