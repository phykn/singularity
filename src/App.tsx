import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { ArrowRight, Check, CircleDot, CircleHelp, FastForward, Gauge, GitFork, MoveUpRight, Orbit, Pause, Repeat2, Route, SlidersHorizontal, Sun, TriangleAlert, Waypoints, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Game } from './game.ts';
import { ElectronScene } from './scene.ts';
import { GameAudio } from './audio.ts';
import { SkillPreview } from './SkillPreview.tsx';
import { bestRecord, readLanguage, readRecord, readRun, readSettings, languageKey, recordKey, save, saveRun, settingsKey } from './storage.ts';
import type { Record as Best, Settings } from './storage.ts';
import { rules, skillIds, statIds, rarityIds, numberText } from './rules.ts';
import type { UpgradeId } from './rules.ts';
import { copy, languages, skillChange, skillValue } from './i18n.ts';
import type { Language } from './i18n.ts';

const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const firstSeed = () => {
  const seed = new URLSearchParams(location.search).get('seed');
  return import.meta.env.DEV && seed !== null && /^\d+$/.test(seed) ? Number(seed) >>> 0 : newSeed();
};

const skillIcons: Record<UpgradeId, LucideIcon> = { power: Zap, rate: FastForward, accel: Gauge, area: CircleDot, repeat: Repeat2, multi: GitFork, chain: Waypoints, pierce: MoveUpRight, satellite: Orbit, trail: Route, burst: Sun };
export function SkillIcon({ id, size = 24 }: { id: UpgradeId; size?: number }) {
  const Icon = skillIcons[id];
  return <Icon className="skill-icon" size={size} strokeWidth={size <= 16 ? 1.4 : 1.7} absoluteStrokeWidth aria-hidden="true" />;
}

function Rank({ value }: { value: number }) {
  return <span className="rank" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={n <= value ? 'on' : ''} />)}</span>;
}

function LanguagePicker({ value, onChange }: { value: Language; onChange: (language: Language) => void }) {
  return <div className="language-picker" role="group" aria-label={copy[value].language}>
    {languages.map(({ id, label, html }) => <button key={id} lang={html} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => { try { return readLanguage(localStorage); } catch { return 'ko'; } });
  const c = copy[language];
  const [settings, setSettings] = useState<Settings>(() => {
    try { return readSettings(localStorage, matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch { return { sound: false, reduced: false }; }
  });
  const [best, setBest] = useState<Best | null>(() => { try { return readRecord(localStorage); } catch { return null; } });
  const [storageOk, setStorageOk] = useState(true);
  const [guide, setGuide] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [, redraw] = useState(0);
  const model = useRef<Game | null>(null);
  model.current ??= (() => { try { return readRun(localStorage) ?? new Game(firstSeed()); } catch { return new Game(firstSeed()); } })();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const bestRef = useRef(best);
  bestRef.current = best;
  const audio = useRef(new GameAudio());
  const canvas = useRef<HTMLDivElement>(null);
  const lastWall = useRef(performance.now());
  const processed = useRef<Game | null>(null);
  const heard = useRef(model.current.events.length);
  const force = () => redraw((n) => n + 1);
  const game = model.current;
  const modal = guide || settingsOpen || game.manualPaused || game.phase === 'result';

  function persist(current = model.current!) {
    try { setStorageOk(saveRun(localStorage, current)); } catch { setStorageOk(false); }
  }

  function changeSettings(next: Settings) {
    settingsRef.current = next;
    setSettings(next);
    try { setStorageOk(save(localStorage, settingsKey, next)); } catch { setStorageOk(false); }
  }

  function changeLanguage(next: Language) {
    setLanguage(next);
    try { setStorageOk(save(localStorage, languageKey, next)); } catch { setStorageOk(false); }
  }

  useEffect(() => { document.documentElement.lang = languages.find((entry) => entry.id === language)!.html; }, [language]);

  async function enableAudio() {
    const enabled = await audio.current.unlock();
    setAudioUnavailable(!enabled);
    return enabled;
  }

  async function toggleSound() {
    const sound = !settingsRef.current.sound;
    if (sound && !(await enableAudio())) return;
    audio.current.enabled = sound;
    if (!sound) audio.current.suspend();
    changeSettings({ ...settingsRef.current, sound });
  }

  function replace(seed: number, start = false) {
    const next = new Game(seed);
    next.setHidden(document.hidden);
    if (start) next.start();
    model.current = next;
    persist(next);
    heard.current = 0;
    processed.current = null;
    setExitConfirm(false);
    setSettingsOpen(false);
    lastWall.current = performance.now();
    force();
  }

  function begin() {
    if (settingsRef.current.sound) void enableAudio();
    lastWall.current = performance.now();
    model.current!.start();
    persist();
    force();
  }

  function pause(paused: boolean) {
    model.current!.setManualPause(paused);
    persist();
    lastWall.current = performance.now();
    if (paused) audio.current.suspend();
    else if (settingsRef.current.sound) void enableAudio();
    setExitConfirm(false);
    force();
  }

  useEffect(() => {
    const node = canvas.current!;
    const scene = new ElectronScene(() => model.current!, () => settingsRef.current.reduced);
    const engine = new Phaser.Game({
      type: Phaser.AUTO, parent: node, width: node.clientWidth || 360, height: node.clientHeight || 320,
      backgroundColor: '#080a0e', scene: [scene], banner: false, audio: { noAudio: true },
      render: { antialias: true, pixelArt: false, roundPixels: false },
      scale: { mode: Phaser.Scale.NONE }, fps: { target: 60 },
    });
    const observer = new ResizeObserver(() => { if (node.clientWidth && node.clientHeight) engine.scale.resize(node.clientWidth, node.clientHeight); });
    observer.observe(node);
    return () => { observer.disconnect(); engine.destroy(true); };
  }, []);

  useEffect(() => {
    let frame = 0, lastDraw = 0, lastSave = 0;
    const visibility = () => {
      if (document.hidden && !model.current!.hiddenPaused) model.current!.advance(Math.max(0, performance.now() - lastWall.current));
      model.current!.setHidden(document.hidden);
      lastWall.current = performance.now();
      if (document.hidden) { audio.current.suspend(); persist(); }
      else if (settingsRef.current.sound && !model.current!.manualPaused) void audio.current.unlock();
      force();
    };
    const suspend = () => { model.current!.setHidden(true); persist(); audio.current.suspend(); lastWall.current = performance.now(); };
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('freeze', suspend);
    document.addEventListener('resume', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', visibility);
    model.current!.setHidden(document.hidden);
    const step = (wall: number) => {
      const current = model.current!;
      current.advance(Math.max(0, wall - lastWall.current));
      lastWall.current = wall;
      for (const event of current.events.slice(heard.current)) {
        if (event.kind === 'hit') audio.current.play((event.data as { kind: string }).kind === 'dense' ? 'dense' : 'hit');
        else if (['level', 'wave', 'charged', 'collision', 'ending'].includes(event.kind)) audio.current.play(event.kind);
      }
      heard.current = current.events.length;
      if (current.result && processed.current !== current) {
        processed.current = current;
        const record = bestRecord(bestRef.current, current.result);
        bestRef.current = record;
        setBest(record);
        try { setStorageOk(save(localStorage, recordKey, record)); } catch { setStorageOk(false); }
        persist(current);
      }
      if (!current.hiddenPaused && current.phase !== 'ready' && current.phase !== 'result' && wall - lastSave >= 1000) { persist(current); lastSave = wall; }
      if (wall - lastDraw > 80) { force(); lastDraw = wall; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      persist(); cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('freeze', suspend); document.removeEventListener('resume', visibility);
      window.removeEventListener('pagehide', suspend); window.removeEventListener('pageshow', visibility); audio.current.destroy();
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__gameDebug = {
      getModel: () => model.current!,
      advance: (ms: number) => { model.current!.advance(ms); lastWall.current = performance.now(); force(); },
      xp: (xp: number) => { model.current!.debugSetXp(xp); force(); },
      restart: (seed: number, combat = true) => {
        const next = new Game(seed, { combat });
        model.current = next; heard.current = 0; processed.current = null;
        next.start(); persist(next); lastWall.current = performance.now(); force();
      },
    };
    return () => { delete window.__gameDebug; };
  }, []);

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    (dialog?.querySelector<HTMLElement>('button.primary') ?? dialog?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), summary')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [modal, guide, settingsOpen, exitConfirm]);

  const choice = game.choice;
  const owned = skillIds.filter((id) => game.rank(id));
  const energyPercent = Math.min(100, Math.floor(game.xp / rules.energyGoal * 100));
  const ready = game.phase === 'ready', result = game.result;
  const secondsLeft = choice ? Math.max(0, choice.deadline - game.time) : 0;
  const title = result?.outcome === 'success' ? c.success : c.failure;
  const value = (id: UpgradeId, rank = game.rank(id)) => skillValue(id, rank, game.rarities[id], language);
  const change = (id: UpgradeId, rarity: typeof game.rarities[UpgradeId]) => skillChange(id, game.rank(id), rarity, game.rarities[id], language);
  const notice = (audioUnavailable || !storageOk) && <p className="setting-notice" role="status">{audioUnavailable ? c.audioFailed : c.storageFailed}</p>;
  const settingsControls = <div className="settings-controls">
    <button className="setting-row" onClick={() => void toggleSound()} aria-label={c.sound + ' ' + (settings.sound ? c.on : c.off)} aria-pressed={settings.sound}><span>{c.sound}</span><span>{settings.sound ? c.on : c.off}<i className="switch" /></span></button>
    <button className="setting-row" onClick={() => changeSettings({ ...settings, reduced: !settings.reduced })} aria-label={c.effects + ' ' + (settings.reduced ? c.reduced : c.normal)} aria-pressed={settings.reduced}><span>{c.effects}</span><span>{settings.reduced ? c.reduced : c.normal}<i className="switch" /></span></button>
  </div>;
  const progress = game.levelProgress;
  const xpPercent = progress.required ? Math.min(100, progress.current / progress.required * 100) : 100;

  return <main className={`app ${game.charged ? 'is-charged' : ''} ${ready ? 'is-ready' : ''} ${settings.reduced ? 'is-reduced' : ''} ${choice ? 'has-choice' : ''}`}>
    <div className="play-layout" inert={modal}>
      {ready ? <header className="topbar">
        <Orbit className="brand-mark" size={24} aria-hidden="true" />
        <div className="header-actions">
          <button className="icon-button" aria-label={c.guide} onClick={() => setGuide(true)}><CircleHelp aria-hidden="true" /></button>
          <button className="icon-button" aria-label={c.settings} onClick={() => setSettingsOpen(true)}><SlidersHorizontal aria-hidden="true" /></button>
        </div>
      </header> : <section className="hud" aria-label={c.hud}>
        <div className="hud-top">
          <div className="level"><span>Lv.</span><strong>{game.level.toString().padStart(2, '0')}</strong></div>
          <div className="boosts" aria-label={c.stats}>{statIds.map((id) => <div className="boost" data-rarity={game.rarities[id]} key={id} aria-label={c.upgrades[id].short + ', ' + value(id)} title={value(id)}><SkillIcon id={id} size={14} /><b>{id === 'power' ? numberText(game.damage) : id === 'rate' ? game.rate.toFixed(2) + '×' : Math.round(game.speed)}</b></div>)}</div>
          <button className="icon-button pause-button" onClick={() => pause(true)} disabled={game.phase === 'result'} aria-label={c.pause}><Pause aria-hidden="true" /></button>
        </div>
        <div className="energy-status">
          <span className={game.charged ? 'charged-label' : game.margin < 24 ? 'danger-label' : ''} aria-label={game.charged ? c.ready : (game.margin < 24 ? c.danger + ', ' : '') + c.energy + ' ' + energyPercent + '%'}>
            {game.charged ? <Check size={14} aria-hidden="true" /> : game.margin < 24 ? <TriangleAlert size={14} aria-hidden="true" /> : <Orbit size={14} aria-hidden="true" />}
            {game.charged ? c.ready : c.charge + ' ' + energyPercent + '%'}
          </span>
          <time>{formatTime(Math.max(0, rules.growthSeconds - game.time))}</time>
        </div>
        <div className="track" role="progressbar" aria-label={c.energy} aria-valuenow={Math.min(game.xp, rules.energyGoal)} aria-valuemin={0} aria-valuemax={rules.energyGoal}><i style={{ width: energyPercent + '%' }} /></div>
      </section>}
      <section className="arena" aria-label={c.arena}>
        <div className="canvas" ref={canvas} />
        {!ready && !storageOk && <p className="save-notice" role="status">{c.storageFailed}</p>}
        {ready ? <div className="arena-caption"><h1 lang="en">SINGULARITY</h1></div> : <>
          {game.phase === 'collapse' && <div className="phase-message ending-message"><strong>{c.collapse}</strong></div>}
          {game.phase === 'ending' && <div className="phase-message ending-message"><strong>{game.successfulEnding ? c.success : c.failure}</strong></div>}
          {game.phase === 'running' && game.notice && game.time < game.noticeUntil && <div className="toast" data-rarity={game.rarities[game.notice]} role="status"><SkillIcon id={game.notice} size={18} />{c.upgrades[game.notice].short}<Rank value={game.rank(game.notice)} /></div>}
        </>}
      </section>
      <section className="footer" aria-label={ready ? 'START' : c.loadout}>
        {ready ? <div className="preparation">
          <button className="primary start" onClick={begin}><span>START</span><ArrowRight aria-hidden="true" /></button>
          <LanguagePicker value={language} onChange={changeLanguage} />
          {notice}
        </div> : <div className="play-footer">
          <div className="loadout" aria-label={c.loadout}>{Array.from({ length: 4 }, (_, i) => {
            const id = owned[i];
            return <div className={`slot ${id ? '' : 'empty'}`} key={i} data-rarity={id ? game.rarities[id] : undefined} aria-label={id ? c.rarities[game.rarities[id]] + ' ' + c.upgrades[id].name + ', ' + c.rank + ' ' + game.rank(id) + '/3' : c.empty} title={id ? c.upgrades[id].name + ' · ' + value(id) : undefined}>{id ? <><SkillIcon id={id} size={24} /><Rank value={game.rank(id)} /></> : <i />}</div>;
          })}</div>
          <div className="xp-status">
            <div><span>{c.xp}</span><b>{game.nextXp === undefined ? 'MAX' : progress.current + ' / ' + progress.required}</b></div>
            <div className="xp-track" role="progressbar" aria-label={game.nextXp === undefined ? c.completed : c.xp} aria-valuenow={game.nextXp === undefined ? 1 : progress.current} aria-valuemin={0} aria-valuemax={game.nextXp === undefined ? 1 : progress.required}><i style={{ width: xpPercent + '%' }} /></div>
          </div>
        </div>}
      </section>
      {!ready && choice && <section className="choices" aria-label={c.choices}>
        <div className="choice-header"><strong>{c.growth}</strong><span>{c.countdown(Math.ceil(secondsLeft))}</span></div>
        <div className="cards">{choice.cards.map(({ id, rarity }, i) => <button key={`${choice.number}-${id}`} className={`card ${i === 0 ? 'auto' : ''}`} data-rarity={rarity} aria-label={c.rarities[rarity] + ' ' + c.upgrades[id].name + ', ' + (game.rank(id) ? c.rankUp(game.rank(id), game.rank(id) + 1) : c.newSkill) + ', ' + change(id, rarity) + (i === 0 ? ', ' + c.auto : '')} onClick={() => { game.select(id, false, choice.number); persist(); force(); }} disabled={game.paused || game.phase !== 'running'}>
          <span className="card-label"><b>{c.rarities[rarity]}</b><span>{i === 0 ? c.auto : ''}</span></span>
          <SkillPreview id={id} rank={game.rank(id) + 1} rarity={rarity} />
          <strong>{c.upgrades[id].short}</strong><span className="card-value">{change(id, rarity)}</span>
        </button>)}</div>
        <div className="choice-track"><i style={{ width: secondsLeft / rules.choiceSeconds * 100 + '%' }} /></div>
      </section>}
    </div>

    {guide && <div className="modal"><section role="dialog" aria-modal="true" aria-labelledby="guide-title" className="dialog guide">
      <div className="dialog-title"><h2 id="guide-title">{c.guideTitle}</h2><button className="text-button" onClick={() => setGuide(false)}>{c.close}</button></div>
      <div className="dialog-body"><p>{c.guideEnergy}</p><p>{c.guideGoal(rules.energyGoal)}</p><p>{c.guideChoice}</p>
        <div className="rarity-guide">{rarityIds.map((rarity) => <span key={rarity} data-rarity={rarity}>{c.rarities[rarity]}<b>{rules.rarity[rarity].chance}%</b></span>)}</div>
        <p>{c.guideRarity}</p>
        <div className="skill-guide">{[...statIds, ...skillIds].map((id) => <div key={id}><SkillIcon id={id} /><div><strong>{c.upgrades[id].name}</strong><p>{c.upgrades[id].description}</p><span>{[1, 2, 3].map((rank) => <span className="guide-rank" key={rank}>{rank} · {skillValue(id, rank, 'common', language)}</span>)}</span></div></div>)}</div>
        <p className="muted">{c.guideLimits}</p>
      </div>
    </section></div>}

    {settingsOpen && <div className="modal"><section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="dialog settings-panel">
      <div className="dialog-title"><h2 id="settings-title">{c.settings}</h2><button className="text-button" onClick={() => setSettingsOpen(false)}>{c.close}</button></div>
      <div className="dialog-body">{settingsControls}<LanguagePicker value={language} onChange={changeLanguage} />{notice}</div>
    </section></div>}

    {game.manualPaused && <div className="modal"><section role="dialog" aria-modal="true" aria-labelledby="pause-title" className="dialog pause-panel">
      <div className="dialog-body"><h2 id="pause-title">{exitConfirm ? c.quitTitle : c.pause}</h2>
        {exitConfirm ? <p>{c.quitNote}</p> : <>{settingsControls}<LanguagePicker value={language} onChange={changeLanguage} />{notice}</>}
      </div>
      <div className="dialog-actions">{exitConfirm ? <><button className="primary" onClick={() => replace(game.seed)}>{c.quitConfirm}</button><button className="text-button" onClick={() => setExitConfirm(false)}>{c.back}</button></> : <><button className="primary" onClick={() => pause(false)}>{c.resume}</button><button className="text-button" onClick={() => setExitConfirm(true)}>{c.quit}</button></>}</div>
    </section></div>}

    {result && <div className="modal result-modal"><section role="dialog" aria-modal="true" aria-labelledby="result-title" className={`dialog result ${result.outcome === 'success' ? 'success' : ''}`}>
      <div className="result-heading">
        {result.outcome === 'success' && <div className="black-hole-mark" aria-hidden="true" />}
        <span className="result-time">{formatTime(result.seconds)}</span><h2 id="result-title">{title}</h2>
        {result.outcome !== 'success' && <p>{c.missing(result.missingXp)}</p>}
      </div>
      <div className="dialog-body">
        <div className="result-numbers"><div><span>{c.level}</span><strong>{result.level}</strong></div><div><span>{c.energy}</span><strong>{result.xp}</strong></div><div><span>{c.mass}</span><strong>{result.mass}</strong></div></div>
        <div className="result-build">{owned.map((id) => <div key={id} data-rarity={game.rarities[id]}><SkillIcon id={id} size={22} /><span>{c.upgrades[id].short}</span><small>{c.rarities[game.rarities[id]]}</small><Rank value={game.rank(id)} /></div>)}</div>
        <details><summary>{c.details}</summary>
          <p>{c.seed} {result.seed} · {result.trigger === 'gravity' ? c.early : c.final}</p><p>{c.score} {result.score.toLocaleString(languages.find((entry) => entry.id === language)!.html)}</p>
          <table><thead><tr><th>{c.particle}</th><th>{c.generated}</th><th>{c.killed}</th><th>{c.absorbed}</th><th>{c.remaining}</th></tr></thead><tbody>{(['small', 'dense'] as const).map((kind) => { const counts = result.counts[kind]; return <tr key={kind}><th>{kind === 'small' ? c.small : c.dense}</th><td>{counts.generated}</td><td>{counts.killed}</td><td>{counts.absorbed}</td><td>{counts.remaining}</td></tr>; })}</tbody></table>
          <p>{c.stats} · {statIds.map((id) => c.upgrades[id].short + ' ' + game.rank(id)).join(' / ')}</p>
          {best && <p>{c.best} · {best.outcome === 'success' ? c.success : c.failure} · {c.energy} {best.xp}</p>}
        </details>{notice}
      </div>
      <div className="dialog-actions result-actions"><button className="primary" onClick={() => replace(game.seed)}>{c.retry}</button><button className="text-button" onClick={() => replace(newSeed())}>{c.newRun}</button></div>
    </section></div>}
  </main>;
}

declare global {
  interface Window {
    __gameDebug?: { getModel: () => Game; advance: (ms: number) => void; xp: (xp: number) => void; restart: (seed: number, combat?: boolean) => void };
  }
}

export default App;
