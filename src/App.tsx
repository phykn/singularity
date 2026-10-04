import { useEffect, useState } from 'react';
import { ArrowRight, CircleQuestion as CircleHelp, Circle as Orbit, Pause, SlidersHorizontal } from 'pixelarticons/react';
import { GameCanvas } from './GameCanvas.tsx';
import { SkillPreview } from './SkillPreview.tsx';
import { ChargeIcon, LanguagePicker, ParticleIcon, Rank, SkillIcon, SkillSlot } from './ui.tsx';
import { useGame } from './useGame.ts';
import { skillIds, statIds, rarityIds, numberText } from './rules.ts';
import type { UpgradeId } from './rules.ts';
import { copy, languages } from './i18n.ts';
import { skillChange, skillValue } from './skillText.ts';
import { particleNames, particleSymbols } from './particles.ts';
import type { ParticleKind } from './particles.ts';

const formatTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
function App() {
  const { game, model, settingsRef, language, settings, best, storageOk, audioUnavailable, begin, select, changeLanguage, changeSettings, toggleSound, ...actions } = useGame();
  const c = copy[language];
  const rules = game.rules;
  const [guide, setGuide] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const modal = guide || settingsOpen || game.manualPaused || game.phase === 'result';

  function replace(seed?: number) { actions.replace(seed); setExitConfirm(false); setSettingsOpen(false); }
  function pause(paused: boolean) { actions.pause(paused); setExitConfirm(false); }

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
  const owned = skillIds.filter((id) => game.rank(id)).sort((a, b) => game.selections.findIndex(s => s.id === a) - game.selections.findIndex(s => s.id === b));
  const energyPercent = Math.min(100, Math.floor(game.xp / rules.energyGoal * 100));
  const ready = game.phase === 'ready', result = game.result;
  const secondsLeft = choice ? Math.max(0, choice.deadline - game.time) : 0;
  const duration = rules.growthSeconds + rules.collisionSeconds + rules.successEndingSeconds;
  const remaining = game.phase === 'running' ? duration - game.seconds : game.collisionTime + rules.collisionSeconds + (game.successfulEnding ? rules.successEndingSeconds : rules.failureEndingSeconds) - game.seconds;
  const title = result?.outcome === 'success' ? c.success : c.failure;
  const value = (id: UpgradeId, rank = game.rank(id)) => skillValue(id, rank, game.rarities[id], language, rules);
  const change = (id: UpgradeId, rarity: typeof game.rarities[UpgradeId]) => skillChange(id, game.rank(id), rarity, game.rarities[id], language, rules);
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
        <Orbit className="brand-mark" width={24} height={24} aria-hidden="true" />
        <div className="header-actions">
          <button className="icon-button" aria-label={c.guide} onClick={() => setGuide(true)}><CircleHelp aria-hidden="true" /></button>
          <button className="icon-button" aria-label={c.settings} onClick={() => setSettingsOpen(true)}><SlidersHorizontal aria-hidden="true" /></button>
        </div>
      </header> : <section className="hud" aria-label={c.hud}>
        <div className="hud-top">
          <div className={`charge ${game.charged ? 'charged-label' : ''}`} role="progressbar" aria-label={game.charged ? c.ready : c.charge} aria-valuenow={Math.min(game.xp, rules.energyGoal)} aria-valuemin={0} aria-valuemax={rules.energyGoal}><ChargeIcon progress={energyPercent / 100} /><b>{energyPercent}%</b></div>
          <time>{formatTime(remaining)}</time>
          <button className="icon-button pause-button" onClick={() => pause(true)} disabled={game.phase === 'result'} aria-label={c.pause}><Pause aria-hidden="true" /></button>
        </div>
        <div className="boosts" aria-label={c.stats}>{statIds.map((id) => <div className="boost" key={id} aria-label={c.upgrades[id].short + ', ' + value(id)} title={value(id)}><SkillIcon id={id} size={14} /><b>{id === 'power' ? numberText(game.damage) : id === 'rate' ? game.rate.toFixed(2) + '×' : Math.round(game.speed)}</b></div>)}</div>
      </section>}
      <section className="arena" aria-label={c.arena}>
        <GameCanvas model={model} settings={settingsRef} />
        {!ready && !storageOk && <p className="save-notice" role="status">{c.storageFailed}</p>}
        {ready ? <div className="arena-caption"><h1 lang="en">SINGULARITY</h1></div> : <>
          {game.phase === 'collapse' && <span className="sr-only" role="status">{c.collapse}</span>}
          {game.phase === 'ending' && <span className="sr-only" role="status">{game.successfulEnding ? c.success : c.failure}</span>}
        </>}
      </section>
      <section className="footer" aria-label={ready ? 'START' : c.loadout}>
        {ready ? <div className="preparation">
          <button className="primary start" onClick={begin}><span>START</span><ArrowRight aria-hidden="true" /></button>
          <LanguagePicker value={language} onChange={changeLanguage} />
          {notice}
        </div> : <div className="play-footer">
          <div className="xp-status">
            <div><span className="level">Lv. <b>{game.level.toString().padStart(2, '0')}</b></span><span>XP</span><b>{game.nextXp === undefined ? 'MAX' : progress.current + ' / ' + progress.required}</b></div>
            <div className="xp-track" role="progressbar" aria-label={game.nextXp === undefined ? c.completed : c.xp} aria-valuenow={game.nextXp === undefined ? 1 : progress.current} aria-valuemin={0} aria-valuemax={game.nextXp === undefined ? 1 : progress.required}><i style={{ width: xpPercent + '%' }} /></div>
          </div>
          <div className="loadout" aria-label={c.loadout}>{Array.from({ length: 4 }, (_, i) => {
            const id = owned[i];
            const status = id ? game.skillStatus(id) : null;
            return <div className={`slot ${id ? '' : 'empty'}`} key={id ? id + game.rank(id) : i} data-skill={id} data-mode={status?.mode} data-active={status?.active} data-fired={status?.fired} data-acquired={game.notice === id && game.time < game.noticeUntil} data-rarity={id ? game.rarities[id] : undefined} role={status && status.mode !== 'conditional' ? 'progressbar' : 'img'} aria-valuemin={status && status.mode !== 'conditional' ? 0 : undefined} aria-valuemax={status && status.mode !== 'conditional' ? 100 : undefined} aria-valuenow={status && status.mode !== 'conditional' ? Math.floor(status.progress * 100) : undefined} aria-label={id ? c.rarities[game.rarities[id]] + ' ' + c.upgrades[id].name + ', ' + c.rank + ' ' + game.rank(id) + '/' + rules.maxRank : c.empty} title={id ? c.upgrades[id].name + ' · ' + value(id) : undefined}>{id && status ? <SkillSlot id={id} status={status} rank={game.rank(id)} max={rules.maxRank} /> : <i />}</div>;
          })}</div>
        </div>}
      </section>
      {!ready && choice && <section className="choices" aria-label={c.choices}>
        <div className="choice-header"><strong>{c.growth}</strong><span aria-label={c.countdown(Math.ceil(secondsLeft))}>{c.auto} {Math.ceil(secondsLeft)}{c.seconds}</span></div>
        <div className="cards">{choice.cards.map(({ id, rarity }, i) => <button key={`${choice.number}-${id}`} className={`card ${i === 0 ? 'auto' : ''}`} data-rarity={rarity} aria-label={c.rarities[rarity] + ' ' + c.upgrades[id].name + ', ' + (game.rank(id) ? c.rankUp(game.rank(id), game.rank(id) + 1) : c.newSkill) + ', ' + change(id, rarity) + (i === 0 ? ', ' + c.auto : '')} onClick={() => { select(id, choice.number); }} disabled={game.paused || game.phase !== 'running'}>
          <span className="card-label"><b>{c.rarities[rarity]}</b>{i === 0 && <ArrowRight width={12} height={12} aria-hidden="true" />}</span>
          <SkillPreview cfg={rules} id={id} rank={game.rank(id) + 1} rarity={rarity} />
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
        <div className="particle-guide">{(Object.keys(particleNames[language]) as ParticleKind[]).map(id => <div key={id}><ParticleIcon id={id} /><b>{particleSymbols[id]}</b><span>{particleNames[language][id]}</span></div>)}</div>
        <div className="skill-guide">{[...statIds, ...skillIds].map((id) => <div key={id}><SkillIcon id={id} /><div><strong>{c.upgrades[id].name}</strong><p>{c.upgrades[id].description}</p><span>{Array.from({ length: rules.maxRank }, (_, i) => i + 1).map((rank) => <span className="guide-rank" key={rank}>{rank} · {skillValue(id, rank, 'common', language, rules)}</span>)}</span></div></div>)}</div>
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
        <div className="result-build">{owned.map((id) => <div key={id} data-rarity={game.rarities[id]}><SkillIcon id={id} size={22} /><span>{c.upgrades[id].short}</span><small>{c.rarities[game.rarities[id]]}</small><Rank value={game.rank(id)} max={rules.maxRank} /></div>)}</div>
        <details><summary>{c.details}</summary>
          <p>{c.seed} {result.seed} · {result.trigger === 'gravity' ? c.early : c.final}</p><p>{c.score} {result.score.toLocaleString(languages.find((entry) => entry.id === language)!.html)}</p>
          <table><thead><tr><th>{c.particle}</th><th>{c.generated}</th><th>{c.killed}</th><th>{c.absorbed}</th><th>{c.remaining}</th></tr></thead><tbody>{(['small', 'dense'] as const).map((kind) => { const counts = result.counts[kind]; return <tr key={kind}><th>{kind === 'small' ? c.small : c.dense}</th><td>{counts.generated}</td><td>{counts.killed}</td><td>{counts.absorbed}</td><td>{counts.remaining}</td></tr>; })}</tbody></table>
          <p>{c.stats} · {statIds.map((id) => c.upgrades[id].short + ' ' + game.rank(id)).join(' / ')}</p>
          {best && <p>{c.best} · {best.outcome === 'success' ? c.success : c.failure} · {c.energy} {best.xp}</p>}
        </details>{notice}
      </div>
      <div className="dialog-actions result-actions"><button className="primary" onClick={() => replace(game.seed)}>{c.retry}</button><button className="text-button" onClick={() => replace()}>{c.newRun}</button></div>
    </section></div>}
  </main>;
}

export default App;
