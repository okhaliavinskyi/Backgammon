import { useEffect, useRef, useState } from 'react';
import { ALL_COSMETICS, COSMETICS, levelForXp, xpForLevel, initialBoard, type Cosmetic } from '@nardy/core';
import { useSettings, type Theme } from '../lib/settings';
import { loadProgress, updateProgress, useProgress } from '../lib/progress';
import { PageHead, type Nav } from './Menus';
import { BoardView as Board } from '../components/Board';
import './progress.css';

export function PlayerAvatar({ equipped }: { equipped?: Partial<Record<import('@nardy/core').CosmeticKind, string>> }) {
  const avatar = ALL_COSMETICS.find(x => x.id === equipped?.avatar);
  const frame = ALL_COSMETICS.find(x => x.id === equipped?.frame);
  return <span className="progress-avatar" style={{ borderColor: frame?.value ?? 'transparent' }} aria-hidden>{avatar?.value ?? '●'}</span>;
}
const badgeNames: Record<string, [string, string]> = {
  'first-win': ['Первая победа', 'First win'], 'games-10': ['10 партий', '10 games'], 'wins-10': ['10 побед', '10 wins'],
  'games-50': ['50 партий', '50 games'], 'wins-50': ['50 побед', '50 wins'], 'games-100': ['100 партий', '100 games'],
};
export function ProgressScreen({ nav }: { nav: Nav }) {
  const ru = useSettings(s => s.lang) === 'ru';
  const name = useSettings(s => s.name);
  const hidden = useSettings(s => s.hideProgress);
  const { profile: p, error } = useProgress();
  const previewRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<Cosmetic | null>(null);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { void loadProgress(true); }, []);
  const act = async (item: Cosmetic, purchase: boolean) => {
    setBusy(true); setMessage('');
    try { await updateProgress(purchase ? 'purchase' : 'equip', { id: item.id, kind: item.kind }); }
    catch (e) { setMessage(e instanceof Error && e.message === 'not_enough_coins' ? (ru ? 'Недостаточно монет' : 'Not enough coins') : (ru ? 'Не удалось сохранить. Попробуйте ещё раз.' : 'Could not save. Please retry.')); }
    finally { setBusy(false); }
  };
  const level = p ? levelForXp(p.xp) : 1;
  const equipped = { ...p?.equipped, ...(preview ? { [preview.kind]: preview.id } : {}) };
  return <main className="screen form progress-screen">
    <PageHead title={ru ? 'Профиль и магазин' : 'Profile & shop'} onBack={() => nav('/')} />
    <p className="muted">{ru ? 'Без регистрации. Прогресс связан с этим браузером; очистка данных может привести к потере доступа.' : 'No account needed. Progress belongs to this browser; clearing its data may lose access.'}</p>
    {error && <p role="alert">{ru ? 'Прогресс временно недоступен. Обычная игра работает.' : 'Progress is temporarily unavailable. You can still play.'} <button className="btn" onClick={() => void loadProgress(true)}>{ru ? 'Повторить' : 'Retry'}</button></p>}
    {!p && !error && <p role="status">{ru ? 'Загрузка…' : 'Loading…'}</p>}
    {p && <>
      <section className="card"><h3><PlayerAvatar equipped={p.equipped} /> {name || (ru ? 'Игрок' : 'Player')}</h3>
        <p>{ru ? 'Уровень' : 'Level'} {level} · {p.coins} {ru ? 'монет' : 'coins'}</p>
        <progress max={xpForLevel(level + 1) - xpForLevel(level)} value={p.xp - xpForLevel(level)} aria-label={ru ? 'Опыт до следующего уровня' : 'Level progress'} />
        <p>{p.xp - xpForLevel(level)} / {xpForLevel(level + 1) - xpForLevel(level)} XP</p>
        <label><input type="checkbox" checked={hidden} onChange={e => useSettings.getState().set({ hideProgress: e.target.checked })} /> {ru ? 'Скрывать прогресс в игре' : 'Hide progress during games'}</label>
      </section>
      <section className="card"><h3>{ru ? 'Статистика онлайн-матчей' : 'Online match statistics'}</h3>
        {(['long', 'short'] as const).map(v => { const s = p.stats[v]; return <p key={v}><b>{v === 'long' ? (ru ? 'Длинные' : 'Long') : (ru ? 'Короткие' : 'Short')}</b>: {s.matches ? `${s.wins} ${ru ? 'побед' : 'wins'} · ${s.losses} ${ru ? 'поражений' : 'losses'} · ${Math.round(s.wins / s.matches * 100)}%` : (ru ? 'Пока нет матчей' : 'No matches yet')} · {s.games} {ru ? 'партий' : 'games'}</p>; })}
        <h3>{ru ? 'Значки' : 'Badges'}</h3><p>{p.badges.length ? p.badges.map(id => badgeNames[id]?.[ru ? 0 : 1]).join(' · ') : (ru ? 'Первый значок — за первую победу в зачётной партии.' : 'Win a qualifying game for your first badge.')}</p>
      </section>
      <section><h3>{ru ? 'Магазин и коллекция' : 'Shop & collection'}</h3><p className="muted">{ru ? 'Монеты — за онлайн-партии с людьми: 20 за поражение, 30 за победу. Все игровые режимы доступны при нулевом балансе.' : 'Earn coins online against people: 20 for a loss, 30 for a win. A zero balance never prevents play.'}</p>
        <div className="cosmetic-grid">{[...COSMETICS, ...ALL_COSMETICS.filter(x => x.price === 0 && p.owned.includes(x.id))].map(item => <button className="card cosmetic-card" key={item.id} onClick={() => { setPreview(item); setMessage(''); }}><span aria-hidden>{item.kind === 'avatar' ? item.value : item.kind === 'dice' ? '⚄' : item.kind === 'frame' ? '◉' : '▧'}</span><b>{ru ? item.ru : item.en}</b><small>{p.equipped[item.kind] === item.id ? (ru ? 'Выбрано' : 'Selected') : p.owned.includes(item.id) ? (ru ? 'В коллекции' : 'Owned') : `${item.price} ${ru ? 'монет' : 'coins'}`}</small></button>)}</div>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { for (const kind of ['avatar', 'frame', 'dice', 'theme'] as const) await updateProgress('equip', { kind, id: null }); } catch { setMessage(ru ? 'Не удалось сбросить оформление' : 'Could not reset appearance'); } finally { setBusy(false); } }}>{ru ? 'Базовое оформление' : 'Default appearance'}</button>
      </section>
      {preview && <section ref={previewRef} tabIndex={-1} className="card cosmetic-preview" aria-label={ru ? 'Примерка' : 'Preview'}><h3>{ru ? preview.ru : preview.en}</h3>
        <PlayerAvatar equipped={equipped} />
        {preview.kind === 'theme' && <div className="board-wrap"><Board board={initialBoard('long')} theme={preview.value as Theme} variant="long" viewer={0} moveMs={0} movable={new Set()} dimMovable={new Set()} selected={null} targets={new Set()} lastMove={new Set()} mover={null} hints={false} onLocClick={() => {}} onDrop={() => {}} /></div>}
        {preview.kind === 'dice' && <div className={'dice-sample ' + preview.value}>⚄ ⚂</div>}
        <p>{p.owned.includes(preview.id) ? (ru ? 'Предмет уже ваш' : 'Already owned') : `${ru ? 'Покупка:' : 'Purchase:'} ${preview.price} ${ru ? 'монет. Предмет:' : 'coins. Item:'} ${ru ? preview.ru : preview.en}`}</p>
        <button className="btn primary" disabled={busy || p.equipped[preview.kind] === preview.id || (!p.owned.includes(preview.id) && p.coins < preview.price)} onClick={() => void act(preview, !p.owned.includes(preview.id))}>{p.equipped[preview.kind] === preview.id ? (ru ? 'Выбрано' : 'Selected') : p.owned.includes(preview.id) ? (ru ? 'Применить' : 'Apply') : (ru ? 'Подтвердить покупку' : 'Confirm purchase')}</button>
        {!p.owned.includes(preview.id) && p.coins < preview.price && <p>{ru ? 'Не хватает' : 'Need'} {preview.price - p.coins} {ru ? 'монет' : 'more coins'}</p>}
        <button className="btn" onClick={() => setPreview(null)}>{ru ? 'Закрыть примерку' : 'Close preview'}</button>
      </section>}
      {message && <p role="alert">{message}</p>}
    </>}
  </main>;
}

export function GameProgress({ event, eligible }: { event: string; eligible?: boolean }) {
  const ru = useSettings(s => s.lang) === 'ru', hidden = useSettings(s => s.hideProgress);
  const { profile, pair } = useProgress();
  if (hidden) return null;
  const reward = profile?.lastReward;
  return <div className="game-progress">
    {eligible === false && <p>{ru ? 'Эта партия без прогресса. Проверьте, не открыта ли другая онлайн-комната.' : 'Progress is unavailable for this game. Check for another open online room.'}</p>}
    {eligible !== false && reward?.event === event && <p>{reward.qualified ? `+${reward.xp} XP · +${reward.coins} ${ru ? 'монет' : 'coins'}` : (ru ? 'Короткая партия — без наград' : 'Short game — no rewards')}{reward.limited && <small>{ru ? 'Монеты за игры с этим соперником сегодня получены. Опыт продолжает расти.' : 'Daily coins with this opponent collected. XP keeps growing.'}</small>}</p>}
    {pair && <p>{ru ? 'Личные встречи (матчи)' : 'Head-to-head matches'}: {pair.wins} : {pair.losses}</p>}
  </div>;
}
