import { gamePath } from '../lib/paths';
import { useEffect, useRef, useState } from 'react';
import { ratingLabel, type SearchStatus, type Variant } from '@nardy/core';
import { useSettings } from '../lib/settings';
import { loadProgress, useProgress } from '../lib/progress';
import { PageHead, type Nav } from './Menus';

export function RankedScreen({ nav }: { nav: Nav }) {
  const ru = useSettings(s => s.lang) === 'ru', name = useSettings(s => s.name);
  const profile = useProgress(s => s.profile);
  const [variant, setVariant] = useState<Variant>('long');
  const [status, setStatus] = useState<SearchStatus>({ status: 'idle' });
  const [input, setInput] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const current = useRef(variant), disposed = useRef(false);
  current.current = variant;
  const navigate = useRef(nav); navigate.current = nav;
  const accept = (data: SearchStatus) => {
    setStatus(data);
    if (data.status === 'matched') navigate.current('/r/' + data.room);
  };
  async function request(method: 'GET' | 'POST' | 'DELETE', v = variant): Promise<SearchStatus> {
    const r = await fetch(gamePath('/api/ranked/' + v), { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify({ name: useSettings.getState().name }) : undefined, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('search_failed'); return r.json();
  }
  useEffect(() => {
    disposed.current = false;
    return () => { disposed.current = true; void fetch(gamePath('/api/ranked/' + current.current), { method: 'DELETE', keepalive: true }).catch(() => {}); };
  }, []);
  useEffect(() => {
    let active = true;
    const version = ++epoch.current;
    setStatus({ status: 'idle' }); setError('');
    void loadProgress(true).then(async () => {
      try { const data = await request('GET', variant); if (active && version === epoch.current) accept(data); }
      catch { if (active && version === epoch.current) setError(ru ? 'Поиск временно недоступен. Игра с другом доступна.' : 'Search is temporarily unavailable. Friend games are available.'); }
    });
    return () => { active = false; };
  }, [variant]);
  useEffect(() => {
    if (status.status !== 'searching') return;
    let active = true, inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return; inFlight = true; const version = epoch.current;
      try { const data = await request('GET'); if (active && version === epoch.current) { setError(''); accept(data); } }
      catch { if (active && version === epoch.current) setError(ru ? 'Нет связи с подбором. Восстанавливаем…' : 'Reconnecting to matchmaking…'); }
      finally { inFlight = false; }
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [status.status, variant]);
  const act = async (method: 'POST' | 'DELETE') => {
    const version = ++epoch.current;
    setBusy(true); setError('');
    try {
      if (method === 'POST' && !useSettings.getState().name.trim()) return;
      await loadProgress(true);
      const data = await request(method); if (!disposed.current && version === epoch.current) accept(data); return data;
    } catch { if (!disposed.current && version === epoch.current) setError(ru ? 'Не удалось связаться с подбором. Повторите попытку.' : 'Could not contact matchmaking. Please retry.'); }
    finally { if (!disposed.current && version === epoch.current) setBusy(false); }
  };
  const searching = status.status === 'searching';
  return <main className="screen form">
    <PageHead title={ru ? 'Рейтинговая игра' : 'Ranked game'} onBack={() => { void act('DELETE').then(data => { if (!disposed.current && data?.status !== 'matched') nav('/'); }); }} />
    <p className="muted">{ru ? 'Без регистрации и ставок. Матч до 3 очков · 15 секунд на ход, затем банк 5 минут. В коротких — кубик и Кроуфорд.' : 'No account or stakes. Match to 3 · 15-second delay, then a 5-minute bank. Short games use the cube and Crawford rule.'}</p>
    {!name.trim() && <label className="field"><span>{ru ? 'Ваше имя' : 'Your name'}</span><input maxLength={20} value={input} onChange={e => setInput(e.target.value)} /></label>}
    <div className="seg" role="group" aria-label={ru ? 'Вариант нард' : 'Variant'}>{(['long','short'] as const).map(v => <button key={v} disabled={searching || busy} className={variant === v ? 'on' : ''} onClick={() => setVariant(v)}>{v === 'long' ? (ru ? 'Длинные' : 'Long') : (ru ? 'Короткие' : 'Short')}</button>)}</div>
    {profile && <p>{ratingLabel(profile.ratings[variant], ru)}</p>}
    {searching ? <section className="card" role="status"><h3>{ru ? 'Ищем соперника…' : 'Finding an opponent…'}</h3><p>{ru ? 'Сначала ищем близкий рейтинг, затем расширяем диапазон. Ботов в очереди нет.' : 'We start with similar ratings and gradually widen the range. No bots in this queue.'}</p><button className="btn" disabled={busy} onClick={() => void act('DELETE')}>{ru ? 'Отменить поиск' : 'Cancel search'}</button><button className="link" disabled={busy} onClick={async () => { const data = await act('DELETE'); if (!disposed.current && data?.status !== 'matched') nav('/online'); }}>{ru ? 'Играть с другом' : 'Play a friend'}</button></section> : <button className="btn primary big" disabled={busy || (!name.trim() && !input.trim())} onClick={() => { if (!name.trim()) useSettings.getState().set({ name: input.trim() }); void act('POST'); }}>{ru ? 'Найти соперника' : 'Find opponent'}</button>}
    {status.status === 'busy' && <p role="status">{ru ? 'Уже открыт поиск в другом варианте нард. Переключитесь на него для отмены.' : 'You are already searching in the other variant. Switch to cancel it.'}</p>}
    {error && <p role="alert">{error}</p>}
    <p className="muted">{ru ? 'Первые 10 матчей — калибровка. Рейтинг длинных и коротких считается отдельно. Обычная комната по ссылке рейтинг не меняет.' : 'Your first 10 matches are placement games. Long and short ratings are separate. Friend rooms never change your rating.'}</p>
  </main>;
}
