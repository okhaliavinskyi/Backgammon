import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { diceStats, loadDiceHistories, type DiceHistory as History } from '../lib/dice-history';
import { useSettings } from '../lib/settings';
import './dice-history.css';

export function DiceHistory() {
  const ru = useSettings(s => s.lang) === 'ru';
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const [selected, setSelected] = useState('');
  const histories = loadDiceHistories();
  const h: History | undefined = histories.find(h => h.id === selected) ?? histories[0];
  const [game, setGame] = useState(0);
  const entries = h?.entries.filter(e => !game || e.gameNo === game) ?? [];
  const stats = ([0, 1] as const).map(p => diceStats(entries, p));
  const title = ru ? 'История кубиков' : 'Dice history';
  return <>
    <button className="btn" onClick={() => setOpen(true)}>{title}</button>
    {open && createPortal(<dialog ref={dialog} className="dice-history-layer" aria-label={title} onCancel={() => setOpen(false)}>
      <section className="dice-history-panel">
        <header><h2>{title}</h2><button autoFocus className="btn" onClick={() => setOpen(false)}>{ru ? 'Закрыть' : 'Close'}</button></header>
        {!h ? <p>{ru ? 'Броски появятся после начала новой игры с ИИ.' : 'Rolls will appear when you start a new AI game.'}</p> : <>
          <label>{ru ? 'Матч' : 'Match'} <select value={h.id} onChange={e => { setSelected(e.target.value); setGame(0); }}>
            {histories.map(h => <option key={h.id} value={h.id}>{new Date(h.startedAt).toLocaleString(ru ? 'ru' : 'en')} · {h.finished ? (ru ? 'завершён' : 'finished') : (ru ? 'не завершён' : 'unfinished')}</option>)}
          </select></label>
          <label>{ru ? 'Партия' : 'Game'} <select value={game} onChange={e => setGame(Number(e.target.value))}>
            <option value={0}>{ru ? 'Все' : 'All'}</option>
            {[...new Set(h.entries.map(e => e.gameNo))].map(n => <option key={n} value={n}>{n}</option>)}
          </select></label>
          {h.partial && <p>{ru ? 'Неполная история: запись началась после возобновления старого сохранения.' : 'Partial history: recording began after resuming an older save.'}</p>}
          <table><thead><tr><th>{ru ? 'Показатель' : 'Statistic'}</th><th>{ru ? 'Ты' : 'You'}</th><th>{ru ? 'Компьютер' : 'Computer'}</th></tr></thead><tbody>
            <tr><th>{ru ? 'Бросков' : 'Rolls'}</th>{stats.map((s, i) => <td key={i}>{s.count}</td>)}</tr>
            <tr><th>{ru ? 'Дублей' : 'Doubles'}</th>{stats.map((s, i) => <td key={i}>{s.doubles} ({s.count ? Math.round(s.doubles / s.count * 100) : 0}%)</td>)}</tr>
            <tr><th>{ru ? 'Средняя сумма' : 'Mean sum'}</th>{stats.map((s, i) => <td key={i}>{s.average?.toFixed(2) ?? '—'}</td>)}</tr>
            <tr><th>{ru ? 'Очки с учётом дублей ×4' : 'Pips with doubles ×4'}</th>{stats.map((s, i) => <td key={i}>{s.movement}</td>)}</tr>
            {[1, 2, 3, 4, 5, 6].map(n => <tr key={n}><th>{ru ? 'Грань' : 'Face'} {n}</th>{stats.map((s, i) => <td key={i}>{s.faces[n - 1]}</td>)}</tr>)}
          </tbody></table>
          <p className="muted">{ru ? 'Жеребьёвка показана отдельно и не входит в статистику. Очки кубиков не равны реально сыгранным ходам.' : 'Opening contests are listed separately and excluded from statistics. Dice pips are not actual moves played.'}</p>
          <details><summary>{ru ? 'Все броски по порядку' : 'All rolls in order'} ({entries.length})</summary>
            <ol>{entries.map((e, i) => <li key={i}>{ru ? 'Партия' : 'Game'} {e.gameNo} · {e.kind === 'opening' ? (ru ? 'Жеребьёвка (ты / ИИ)' : 'Opening (you / AI)') : e.player === 0 ? (ru ? 'Ты' : 'You') : (ru ? 'Компьютер' : 'Computer')} · <b>{e.dice.join(' + ')}</b>{!e.accepted ? (ru ? ' — переброс' : ' — reroll') : ''}</li>)}</ol>
          </details>
          <p className="muted">{ru ? 'На этом устройстве сохраняются последние 10 матчей. Отправка серверных логов требует подключения к сети.' : 'The last 10 matches are saved on this device. Server logging requires a network connection.'}</p>
        </>}
      </section>
    </dialog>, document.body)}
  </>;
}
