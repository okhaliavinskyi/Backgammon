import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BAR,
  Board,
  CLAIM_AFTER_MS,
  Color,
  EMOJIS,
  MatchState,
  OFF,
  Step,
  TurnState,
  advance,
  applyStepToBoard,
  canDouble,
  destinationsFrom,
  legalNextSteps,
  other,
  pipCount,
  turnState,
  type Memo,
} from '@nardy/core';
import { SettingsScreen } from './Menus';
import { BoardView } from '../components/Board';
import { Cube, DiceCup, Die } from '../components/Dice';
import { FIELD_END, FRAME, Loc, locOf, posOfSlot } from '../components/geometry';
import { actor, useGame } from '../controllers/store';
import { useT } from '../lib/i18n';
import { diceMs, moveMs, useSettings } from '../lib/settings';
import { bearOff, checkerHit, checkerPlace, chime, cupShake, diceRoll, fanfare, unlockAudio, vibrate } from '../lib/sound';
import { listenShake, motionSupported, needsPermission, requestMotionPermission } from '../lib/shake';

interface Pending {
  seq: number;
  chains: Step[][];
  ts: TurnState;
}

function useCompactLayout(): boolean {
  const query = '(orientation: portrait) and (max-width: 767px)';
  const [compact, setCompact] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

function useNow(active: boolean, every = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [active, every]);
  return now;
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function stepSound(s: Step) {
  if (s.hit) {
    checkerHit();
    vibrate([20, 40, 20]);
  } else if (s.to === OFF) bearOff();
  else checkerPlace();
}

export function GameScreen({ onExit }: { onExit: () => void }) {
  const T = useT();
  const compact = useCompactLayout();
  const [moreOpen, setMoreOpen] = useState(false);
  const g = useGame();
  const st = useSettings();
  const m = g.match!;
  const ctrl = g.controller!;
  const variant = m.settings.variant;
  const viewer = g.viewer;
  const mMs = moveMs(st.speed);
  const dMs = diceMs(st.speed);

  // ───────── displayed board & opponent move animation ─────────
  const [shown, setShown] = useState<Board>(m.board);
  const [animating, setAnimating] = useState(false);
  const prevRef = useRef<MatchState | null>(null);
  const submittedSeq = useRef<number | null>(null);
  const animTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = m;
    animTimers.current.forEach(clearTimeout);
    animTimers.current = [];
    const ev = m.event;
    const own = prev !== null && submittedSeq.current === prev.seq;
    if (prev && prev.gameNo === m.gameNo && m.seq === prev.seq + 1 && ev?.type === 'moved' && !own && mMs > 0) {
      setAnimating(true);
      let b = prev.board;
      ev.steps.forEach((s, i) => {
        b = applyStepToBoard(b, ev.player, s, variant);
        const snapshot = b;
        animTimers.current.push(setTimeout(() => setShown(snapshot), i * (mMs + 60)));
        animTimers.current.push(setTimeout(() => stepSound(s), i * (mMs + 60) + mMs * 0.85));
      });
      animTimers.current.push(
        setTimeout(() => {
          setShown(m.board);
          setAnimating(false);
        }, ev.steps.length * (mMs + 60)),
      );
    } else {
      setShown(m.board);
      setAnimating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.seq, m.gameNo]);

  useEffect(() => () => animTimers.current.forEach(clearTimeout), []);

  // ───────── dice display ─────────
  const [rollKey, setRollKey] = useState('init');
  const [flash, setFlash] = useState<{ player: Color; dice: number[]; text: string } | null>(null);
  useEffect(() => {
    const ev = m.event;
    if (!ev) return;
    if (ev.type === 'rolled' || ev.type === 'nomoves' || ev.type === 'opening') {
      setRollKey(`${m.gameNo}:${m.seq}`);
      if (dMs > 0) diceRoll(dMs);
      vibrate(30);
    }
    if (ev.type === 'nomoves') {
      setFlash({ player: ev.player, dice: ev.dice, text: T.noMoves });
      const id = setTimeout(() => setFlash(null), Math.max(1600, dMs + 900));
      return () => clearTimeout(id);
    }
    setFlash(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.seq, m.gameNo]);

  // ───────── local pending turn ─────────
  const myMove = m.phase === 'move' && g.controls[m.turn];
  const [pending, setPending] = useState<Pending | null>(null);
  const memoRef = useRef<Memo>(new Map());
  const [selected, setSelected] = useState<Loc | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    memoRef.current = new Map();
    setSelected(null);
    setBusy(false);
    setPending(myMove ? { seq: m.seq, chains: [], ts: turnState(m) } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.seq, m.gameNo, myMove]);

  const mover = m.phase === 'move' ? m.turn : null;
  const legal = useMemo(() => (pending ? legalNextSteps(pending.ts, memoRef.current) : []), [pending]);
  const [sent, setSent] = useState(false);
  const [doubled, setDoubled] = useState(false);
  const [paused, setPaused] = useState(false);
  useEffect(() => { setSent(false); setDoubled(false); if (g.error) setPaused(true); }, [m, g.error, g.conn]);
  useEffect(() => setPaused(false), [m.seq, m.gameNo]);
  const canInteract = !!pending && !animating && !busy && !sent;
  const movable = useMemo(() => {
    const s = new Set<Loc>();
    if (!canInteract || mover === null) return s;
    for (const x of legal) s.add(locOf(mover, x.from, viewer, variant));
    return s;
  }, [legal, canInteract, mover, viewer, variant]);

  const dimSet = useRef(new Set<Loc>());
  if (!busy) dimSet.current = movable;

  const locToPos = useCallback(
    (loc: Loc, color: Color): number => (loc === 'bar' ? BAR : loc === 'off' ? OFF : posOfSlot(Number(loc.slice(1)), color, viewer, variant)),
    [viewer, variant],
  );

  const dests = useMemo(() => {
    const map = new Map<Loc, Step[]>();
    if (!pending || !selected || mover === null || !movable.has(selected)) return map;
    for (const d of destinationsFrom(pending.ts, locToPos(selected, mover), memoRef.current)) map.set(locOf(mover, d.to, viewer, variant), d.steps);
    return map;
  }, [pending, selected, mover, movable, locToPos, viewer, variant]);
  const targets = useMemo(() => new Set(dests.keys()), [dests]);

  const turnDone = !!pending && legal.length === 0;

  const UNDO_MS = 1200;
  const [sendAt, setSendAt] = useState<number | null>(null);
  const submit = useCallback(() => {
    if (!pending || sent) return;
    setSent(true);
    setSendAt(null);
    useGame.setState({ error: null });
    submittedSeq.current = pending.seq;
    ctrl.move(pending.chains.flat());
  }, [pending, ctrl, sent]);
  useEffect(() => {
    if (sent || paused || !(turnDone && pending && pending.chains.length > 0 && st.autoConfirm && !busy)) { setSendAt(null); return; }
    setSendAt(Date.now() + UNDO_MS);
    const id = setTimeout(submit, UNDO_MS);
    return () => clearTimeout(id);
  }, [turnDone, pending, st.autoConfirm, submit, busy, sent, paused]);

  const playChain = (steps: Step[]) => {
    if (!pending) return;
    setSelected(null);
    setBusy(true);
    let ts = pending.ts;
    const chains = [...pending.chains, steps];
    steps.forEach((s, i) => {
      ts = advance(ts, s);
      const snap = ts;
      setTimeout(() => {
        setPending((p) => (p && p.seq === pending.seq ? { ...p, ts: snap, chains: i === steps.length - 1 ? chains : p.chains } : p));
        setTimeout(() => stepSound(s), mMs * 0.85);
        if (i === steps.length - 1) setTimeout(() => setBusy(false), mMs * 0.5);
      }, i * (mMs + 40));
    });
  };

  const undo = () => {
    if (!pending || pending.chains.length === 0) return;
    const chains = pending.chains.slice(0, -1);
    let ts = turnState(m);
    for (const s of chains.flat()) ts = advance(ts, s);
    setPending({ ...pending, chains, ts });
    setSelected(null);
  };

  // ───────── roll / shake ─────────
  const rollActor = m.phase === 'roll' && g.controls[m.turn] && !animating;
  const mayDouble = rollActor && canDouble(m, m.turn);
  const doRoll = useCallback(() => {
    unlockAudio();
    ctrl.roll();
  }, [ctrl]);

  const DOUBLE_MS = 2000;
  useEffect(() => {
    if (!rollActor || !st.autoRoll || doubled || g.conn !== 'open') return;
    const id = setTimeout(doRoll, mayDouble ? DOUBLE_MS : 450);
    return () => clearTimeout(id);
  }, [rollActor, st.autoRoll, mayDouble, doRoll, m.seq, doubled, g.conn]);

  const [shaking, setShaking] = useState(false);
  const [impulse, setImpulse] = useState(0);
  const [motionOk, setMotionOk] = useState(!needsPermission());
  const shakeEnabled = st.shake && motionSupported();
  useEffect(() => {
    if (!rollActor || st.autoRoll || !shakeEnabled || !motionOk) return;
    return listenShake({
      onShakeStart: () => setShaking(true),
      onImpulse: (s) => {
        cupShake(s);
        vibrate(12);
        setImpulse((i) => i + 1);
      },
      onThrow: () => {
        setShaking(false);
        doRoll();
      },
    });
  }, [rollActor, st.autoRoll, shakeEnabled, motionOk, doRoll]);

  // Your-turn chime in online games.
  const me = viewer;
  const act = actor(m);
  const prevActor = useRef<Color | null>(null);
  useEffect(() => {
    if (g.mode === 'online' && act === me && prevActor.current !== me) chime();
    prevActor.current = act;
  }, [act, me, g.mode]);

  // Result sounds.
  useEffect(() => {
    if (m.phase === 'gameover' || m.phase === 'matchover') {
      const win = g.mode === 'local' || m.result?.winner === me;
      setTimeout(() => fanfare(!!win), m.event?.type === 'moved' ? m.event.steps.length * mMs : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.phase === 'gameover' || m.phase === 'matchover', m.gameNo]);

  // ───────── board events ─────────
  const onLocClick = (loc: Loc) => {
    unlockAudio();
    if (rollActor && !mayDouble && !st.autoRoll) return doRoll();
    if (!canInteract) return;
    if (selected && dests.has(loc)) return playChain(dests.get(loc)!);
    if (movable.has(loc)) return setSelected(selected === loc ? null : loc);
    setSelected(null);
  };
  const onDrop = (from: Loc, to: Loc) => {
    if (!canInteract || !pending || mover === null || !movable.has(from)) return;
    const d = destinationsFrom(pending.ts, locToPos(from, mover), memoRef.current).find((x) => locOf(mover, x.to, viewer, variant) === to);
    if (d) playChain(d.steps);
  };

  // ───────── derived view ─────────
  const board = pending ? pending.ts.board : shown;
  const showTray = board.off.some((n) => n > 0) || targets.has('off');
  const boardWidth = showTray ? 1000 : FIELD_END + FRAME;
  const lastMove = useMemo(() => {
    const s = new Set<Loc>();
    const ev = m.event;
    if (!pending && ev?.type === 'moved' && !animating) {
      for (const x of ev.steps) {
        s.add(locOf(ev.player, x.from, viewer, variant));
        s.add(locOf(ev.player, x.to, viewer, variant));
      }
    }
    return s;
  }, [m.event, pending, animating, viewer, variant]);

  const now = useNow(true);
  const serverNow = now + g.offset;
  const clocks = g.clocks;

  const clockFor = (c: Color): { text: string; low: boolean } | null => {
    if (!clocks || (!clocks.bank && !clocks.moveTimerMs)) return null;
    const running = act === c && clocks.turnStartedAt !== null;
    const elapsed = running ? serverNow - clocks.turnStartedAt! : 0;
    if (clocks.bank) {
      const delayLeft = Math.max(0, clocks.moveTimerMs - elapsed);
      const bank = clocks.bank[c] - (running ? Math.max(0, elapsed - clocks.moveTimerMs) : 0);
      const text = (running && clocks.moveTimerMs ? `${Math.ceil(delayLeft / 1000)}s · ` : '') + fmt(bank);
      return { text, low: running && bank < 30000 && delayLeft === 0 };
    }
    if (!running) return null;
    const left = clocks.moveTimerMs - elapsed;
    return { text: fmt(left), low: left < 10000 };
  };

  const diceOwner = flash ? flash.player : m.phase === 'move' ? m.turn : null;
  const diceValues = flash ? flash.dice : m.phase === 'move' ? m.dice : [];
  const usedFlags = useMemo(() => {
    if (!diceValues.length) return [];
    const isDouble = diceValues[0] === diceValues[1];
    const remaining = pending ? pending.ts.remaining : m.remaining;
    if (flash) return [true, true];
    if (isDouble) return [remaining.length < 2, remaining.length < 1];
    return diceValues.map((d) => !remaining.includes(d));
  }, [diceValues, pending, m.remaining, flash]);
  const doublesLeft = diceValues.length && diceValues[0] === diceValues[1] && !flash ? (pending ? pending.ts.remaining.length : m.remaining.length) : 0;

  const opp = other(viewer);
  const nameOf = (c: Color) => g.players[c]?.name ?? (c === 0 ? T.white : T.black);

  const statusText = (() => {
    if (m.phase === 'gameover' || m.phase === 'matchover') return '';
    if (g.aiThinking) return T.aiThinking;
    if (g.mode === 'local') return `${T.hotseatTurn}: ${nameOf(act ?? m.turn)}`;
    return act === viewer ? T.yourTurn : T.opponentTurn;
  })();

  const oppSlot = g.players[opp];
  const canClaim = g.mode === 'online' && oppSlot && !oppSlot.connected && oppSlot.disconnectedAt !== null && serverNow - oppSlot.disconnectedAt > CLAIM_AFTER_MS && m.phase !== 'matchover';

  const [confirmResign, setConfirmResign] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (settingsOpen) settingsDialog.current?.showModal(); }, [settingsOpen]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
  }, [g.chat.length, chatOpen]);

  const resultLabel = (() => {
    const r = m.result;
    if (!r) return '';
    const kind = r.kind === 'resign' ? T.byResign : r.kind === 'drop' ? T.byDrop : r.kind === 'timeout' ? T.byTimeout : '';
    const mult = r.multiplier === 3 ? T.backgammon : r.multiplier === 2 ? (variant === 'long' ? T.mars : T.gammon) : T.single;
    return `${r.kind === 'drop' || r.kind === 'timeout' ? '' : mult}${kind ? (r.kind === 'drop' || r.kind === 'timeout' ? kind : ` · ${kind}`) : ''} · +${r.points}`;
  })();

  const isWinner = m.result?.winner === viewer;
  const resultTitle =
    m.phase === 'matchover'
      ? g.mode === 'local'
        ? `${nameOf(m.matchWinner!)} ${T.wonMatch}`
        : m.matchWinner === viewer
          ? T.youWonMatch
          : T.youLostMatch
      : g.mode === 'local'
        ? `${nameOf(m.result?.winner ?? 0)} ${T.wonGame}`
        : isWinner
          ? T.youWonGame
          : T.youLostGame;

  const playerBar = (c: Color, bottom?: boolean) => {
    const p = g.players[c];
    const clk = clockFor(c);
    const active = act === c;
    if (compact) {
      const running = act === c && clocks?.turnStartedAt != null;
      const elapsed = running ? Math.max(0, serverNow - clocks!.turnStartedAt!) : 0;
      const bankLeft = clocks?.bank ? clocks.bank[c] - (running ? Math.max(0, elapsed - clocks.moveTimerMs) : 0) : null;
      const moveLeft = clocks?.moveTimerMs ? Math.max(0, clocks.moveTimerMs - elapsed) : null;
      const pieceLabel = c === 0 ? T.white : st.theme === 'minimal' ? T.red : T.black;
      return <div className={'pbar player-card' + (active ? ' active' : '')}>
        <div className="player-piece">
          <span className={'pchip ' + (c === 0 ? 'w' : 'b')} data-theme-chip={st.theme} />
          <span>{pieceLabel}</span>
        </div>
        <div className="player-card-body">
          <div className="pname" title={p?.name}>{p?.name ?? '—'}</div>
          {p && !p.connected && <span className="tag warn">{T.offline}</span>}
          <div className="player-card-state">
            <i className={'turn-light' + (active ? ' active' : '')} title={active ? T.hotseatTurn : undefined} />
            <span className="player-score" title={T.score}>{m.score[c]}</span>
            {m.cube.owner === c && m.settings.cube && <Cube value={m.cube.value} />}
          </div>
          <div className="pmeta" data-pips={c === viewer ? 'me' : 'opp'}>{pipCount(board, c)} {T.pips} · {board.off[c]}/15</div>
        </div>
        <div className="player-timers">
          <span className="bank-time" title={T.bank}>{bankLeft === null ? '—' : fmt(bankLeft)}</span>
          <span className={'move-time' + (clk?.low ? ' low' : '')} title={T.moveTimer}>{moveLeft === null ? '—' : fmt(moveLeft)}</span>
        </div>
      </div>;
    }
    return (
      <div className={'pbar' + (active ? ' active' : '') + (bottom ? ' bottom' : '')}>
        <span className={'pchip ' + (c === 0 ? 'w' : 'b')} data-theme-chip={st.theme} />
        <div className="pinfo">
          <div className="pname">
            {p?.name ?? '—'}
            {g.mode !== 'local' && c === viewer && <span className="tag">{T.you}</span>}
            {p?.isAi && g.aiLevel && <span className="tag">{T[g.aiLevel]}</span>}
            {p && !p.connected && <span className="tag warn">{T.offline}</span>}
          </div>
          <div className="pmeta" data-pips={c === viewer ? 'me' : 'opp'}>
            {pipCount(board, c)} {T.pips} · {board.off[c]}/15
          </div>
        </div>
        {m.cube.owner === c && m.settings.cube && <Cube value={m.cube.value} />}
        {clk && <div className={'clock' + (clk.low ? ' low' : '') + (active ? ' run' : '')}>{clk.text}</div>}
      </div>
    );
  };

  const nextIn = clocks?.nextGameAt ? Math.max(0, clocks.nextGameAt - (g.mode === 'online' ? serverNow : now)) : null;

  return (
    <div className={'game theme-' + st.theme + (compact ? ' phone-game' : '')}>
      <header className="game-top">
        <button className="icon-btn" onClick={onExit} aria-label={T.toMenu}>
          ←
        </button>
        <div className="score">
          {!compact && <span>{nameOf(0)}</span>}
          <b>
            {m.score[0]} : {m.score[1]}
          </b>
          {!compact && <span>{nameOf(1)}</span>}
          <small>
            {T.matchLength} {m.settings.matchLength} · {variant === 'long' ? T.long : T.short}
            {m.crawford ? ` · ${T.crawford}` : ''}
          </small>
        </div>
        <div className="game-top-actions">
          {g.mode === 'online' && !compact && <button className="icon-btn" onClick={() => setChatOpen((open) => !open)} aria-label={T.chat}>
            💬{g.chat.length > 0 && !chatOpen && <i className="dot" />}
          </button>}
          <button className="icon-btn settings-button" aria-label={T.settings} onClick={() => setSettingsOpen(true)}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="m9.5 3-.7 2.4-1.6.9-2.4-.6-2.5 4.4 1.8 1.8v1.9l-1.8 1.8 2.5 4.3 2.4-.6 1.6 1 .7 2.4h5l.7-2.4 1.6-1 2.4.6 2.5-4.3-1.8-1.8v-1.9l1.8-1.8-2.5-4.4-2.4.6-1.6-.9-.7-2.4z" />
              <circle cx="12" cy="12.8" r="3.2" />
            </svg>
          </button>
        </div>
      </header>

      {!compact && playerBar(opp)}

      <div className={'board-wrap' + (compact ? ' compact-board' : '')} style={{
        aspectRatio: `${boardWidth} / ${compact ? 1100 : 800}`,
        width: compact ? `min(100%, calc((100dvh - 290px) * ${boardWidth} / 1100))` : `min(100%, 1100px, calc((100dvh - 300px) * ${boardWidth} / 800))`,
      }}>
        <BoardView
          cross={compact ? 1100 : 800}
          board={board}
          variant={variant}
          viewer={viewer}
          theme={st.theme}
          moveMs={mMs}
          movable={movable}
          dimMovable={dimSet.current}
          hints={st.hints}
          selected={selected}
          targets={targets}
          lastMove={lastMove}
          mover={mover}
          onLocClick={onLocClick}
          onDrop={onDrop}
          label={statusText}
        />

        {/* dice */}
        {diceOwner !== null && diceValues.length === 2 && (
          <div className={'dice-tray ' + (diceOwner === viewer ? 'right' : 'left')} key={rollKey}>
            {diceValues.map((v, i) => (
              <Die key={i} value={v} rollKey={rollKey} durationMs={dMs} used={usedFlags[i]} dir={diceOwner === viewer ? 1 : -1} index={i} dark={diceOwner !== 0} />
            ))}
            {doublesLeft > 0 && <div className="dbl-left">×{doublesLeft}</div>}
          </div>
        )}
        {/* opening roll in long nardy: one die per player */}
        {m.phase === 'roll' && m.opening && m.turnsTaken[0] + m.turnsTaken[1] === 0 && !flash && (
          <>
            <div className="dice-tray right single">
              <Die value={m.opening[viewer]} rollKey={'op' + m.gameNo} durationMs={dMs} dir={1} dark={viewer !== 0} />
            </div>
            <div className="dice-tray left single">
              <Die value={m.opening[opp]} rollKey={'op' + m.gameNo} durationMs={dMs} dir={-1} dark={opp !== 0} />
            </div>
          </>
        )}

        {flash && <div className="toast">{flash.text}</div>}

        {/* roll prompt */}
        {rollActor && !shaking && (
          <div className="center-actions">
            {!st.autoRoll && <button className="btn primary big" onClick={doRoll}>
              🎲 {T.roll}
            </button>}
            {mayDouble && !doubled && !compact && (
              <button className="btn gold" onClick={() => { setDoubled(true); ctrl.double(); }}>
                ×2 {T.double}
                {st.autoRoll && <i className="countdown" style={{ ['--ms' as string]: `${DOUBLE_MS}ms` }} />}
              </button>
            )}
            {!st.autoRoll && shakeEnabled && motionOk && <div className="hint">{T.shakeOrTap}</div>}
            {!st.autoRoll && shakeEnabled && !motionOk && (
              <button
                className="btn small"
                onClick={async () => {
                  unlockAudio();
                  setMotionOk(await requestMotionPermission());
                }}
              >
                📳 {T.enableShake}
              </button>
            )}
          </div>
        )}
        {shaking && (
          <div className="cup-layer">
            <DiceCup shaking={shaking} impulse={impulse} />
          </div>
        )}

        {/* cube offer */}
        {m.phase === 'cube' && (
          <div className="modal-layer">
            <div className="modal">
              {g.controls[other(m.turn)] ? (
                <>
                  <p>
                    {T.doubleOffered} <b>{m.cube.value * 2}</b>
                  </p>
                  <div className="row">
                    <button className="btn primary" onClick={() => ctrl.take()}>
                      {T.take}
                    </button>
                    <button className="btn" onClick={() => ctrl.drop()}>
                      {T.drop}
                    </button>
                  </div>
                </>
              ) : (
                <p>{T.youOffered}</p>
              )}
            </div>
          </div>
        )}

        {/* game / match over */}
        {(m.phase === 'gameover' || m.phase === 'matchover') && !animating && (
          <div className="modal-layer">
            <div className={'modal result' + (isWinner || g.mode === 'local' ? ' win' : ' lose')}>
              <h2>{resultTitle}</h2>
              <p className="res-kind">{resultLabel}</p>
              <p className="res-score">
                {m.score[0]} : {m.score[1]}
              </p>
              {m.phase === 'gameover' && (
                <>
                  {nextIn !== null && (
                    <p className="muted">
                      {T.nextGameIn} {Math.ceil(nextIn / 1000)}…
                    </p>
                  )}
                  {g.mode !== 'online' && (
                    <button className="btn primary" onClick={() => ctrl.next()}>
                      {T.nextGame}
                    </button>
                  )}
                </>
              )}
              {m.phase === 'matchover' && (
                <div className="row">
                  {g.mode === 'online' && g.room?.rematch[viewer] ? (
                    <span className="muted">{T.rematchWaiting}</span>
                  ) : (
                    <button className="btn primary" onClick={() => ctrl.rematch()}>
                      {T.rematch}
                      {g.mode === 'online' && g.room?.rematch[opp] ? ' ✓' : ''}
                    </button>
                  )}
                  <button className="btn" onClick={onExit}>
                    {T.toMenu}
                  </button>
                </div>
              )}
              {g.mode === 'online' && g.room?.rematch[opp] && !g.room.rematch[viewer] && <p className="muted">{T.rematchOffered}</p>}
            </div>
          </div>
        )}

        {/* floating emojis */}
        <div className="emoji-layer" aria-hidden>
          {g.emojis.map((e) => (
            <span key={e.id} className={'float-emoji ' + (e.from === viewer ? 'me' : 'them')}>
              {e.e}
            </span>
          ))}
        </div>

        {g.conn !== 'open' && <div className="conn-banner">{g.conn === 'connecting' ? T.connecting : T.reconnecting}</div>}
      </div>

      {!compact && playerBar(viewer, true)}

      <div className={compact ? 'mobile-hud' : 'desktop-hud'}>
      {compact && playerBar(viewer, true)}
      <div className="controls">
        {compact && <div className="quick-social">
          {g.mode === 'online' && <button className="btn quick-chat" onClick={() => setChatOpen((open) => !open)} aria-label={T.chat}>
            💬 {T.chat}{g.chat.length > 0 && !chatOpen && <i className="dot" />}
          </button>}
          <div className="quick-reactions">
            {(['👍', '😂', '🔥', '🤝'] as const).map((emoji) => <button key={emoji} type="button" onClick={() => ctrl.emoji(emoji)} aria-label={emoji}>{emoji}</button>)}
          </div>
        </div>}
        <span className="status">{statusText}</span>
        {pending && !sent && pending.chains.length > 0 && (
          <>
            {sendAt !== null ? (
              <button className="btn primary undo-send" onClick={undo}>
                ↶ {T.undo}
                <i className="countdown" style={{ ['--ms' as string]: `${UNDO_MS}ms` }} key={sendAt} />
              </button>
            ) : (
              <button className="btn" disabled={pending.chains.length === 0 || busy} onClick={undo}>
                ↶ {T.undo}
              </button>
            )}
            {(!st.autoConfirm || paused) && <button className="btn primary" disabled={!turnDone || busy} onClick={submit}>
              ✓ {T.done}
            </button>}
          </>
        )}
        {canClaim && (
          <button className="btn gold" onClick={() => ctrl.claim()}>
            {T.claimWin}
          </button>
        )}
        {!compact && m.phase !== 'gameover' && m.phase !== 'matchover' && (g.mode === 'local' || act !== null) && (
          <button className="btn subtle" onClick={() => setConfirmResign(true)}>
            ⚑ {T.resign}
          </button>
        )}
        {compact && mayDouble && !doubled && <button className="btn gold" onClick={() => { setDoubled(true); ctrl.double(); }}>
          ×2 {T.double}
          {st.autoRoll && <i className="countdown" style={{ ['--ms' as string]: `${DOUBLE_MS}ms` }} />}
        </button>}
        {compact && <button className="icon-btn" aria-label={T.more} onClick={() => setMoreOpen((open) => !open)}>⋯</button>}
      </div>

      {compact && playerBar(opp)}
      </div>

      {(!compact || moreOpen) && <div className={compact ? 'phone-more' : undefined}>
      {compact && <button className="icon-btn" aria-label={T.back} onClick={() => setMoreOpen(false)}>✕</button>}
      <div className="emoji-bar">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => ctrl.emoji(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>

      {compact && <button className="btn subtle" onClick={() => { setMoreOpen(false); setConfirmResign(true); }}>⚑ {T.resign}</button>}
      </div>}

      {chatOpen && g.mode === 'online' && (
        <aside className="chat">
          <div className="chat-head">
            <b>{T.chat}</b>
            <button className="icon-btn" onClick={() => setChatOpen(false)}>
              ✕
            </button>
          </div>
          <div className="chat-list">
            {g.chat.map((l, i) => (
              <div key={i} className={'chat-line ' + (l.from === viewer ? 'me' : 'them')}>
                <span>{l.text}</span>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (chatText.trim()) ctrl.chat(chatText);
              setChatText('');
            }}
          >
            <input value={chatText} maxLength={200} onChange={(e) => setChatText(e.target.value)} placeholder={T.chatPlaceholder} />
            <button className="btn primary small">{T.send}</button>
          </form>
        </aside>
      )}

      {settingsOpen && <dialog ref={settingsDialog} className="game-settings" aria-label={T.settings} onClose={() => setSettingsOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <SettingsScreen nav={() => setSettingsOpen(false)} />
      </dialog>}

      {confirmResign && (
        <div className="modal-layer">
          <div className="modal">
            <p>{T.resignConfirm}</p>
            <div className="row">
              <button
                className="btn primary"
                onClick={() => {
                  setConfirmResign(false);
                  ctrl.resign();
                }}
              >
                {T.yes}
              </button>
              <button className="btn" onClick={() => setConfirmResign(false)}>
                {T.no}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
