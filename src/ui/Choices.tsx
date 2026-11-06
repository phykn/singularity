import type { Game } from '../game/Game.ts';
import { isSkill, isStat } from '../game/rules.ts';
import type { Card, UpgradeId } from '../game/rules.ts';
import { ControlIcon, Rank, SkillIcon } from './icons.tsx';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';
import { useChoiceInput } from './useChoiceInput.ts';

export function Choices({
  game,
  language,
  pauseOnChoice,
  secondsLeft,
  interactive,
  onSelect,
  onTogglePause,
}: {
  game: Game;
  language: Language;
  pauseOnChoice: boolean;
  secondsLeft: number;
  interactive: boolean;
  onSelect: (id: UpgradeId, number: number) => void;
  onTogglePause: () => void;
}) {
  const c = copy[language],
    choice = game.phase === 'running' ? game.choice : null,
    automatic = game.automaticCard?.id,
    { cards, pointerReady, accept, navigate } = useChoiceInput(choice, interactive);
  if (!choice) return null;
  const max = game.rules.growth.maxRank,
    seconds = Math.ceil(secondsLeft);
  const tag = ({ id, rarity }: Card) => (isStat(id) ? '' : c.rarities[rarity]);
  const step = (id: UpgradeId) => {
    const rank = game.rank(id);
    return id === 'recover'
      ? c.instant
      : rank || !isSkill(id)
        ? c.rankUp(rank, rank + 1)
        : c.newSkill;
  };
  return (
    <section className="choices" aria-label={c.choices}>
      <div className="choice-header">
        <strong>{c.growth}</strong>
        <div className="choice-actions">
          <span aria-label={pauseOnChoice ? c.choicePause : c.countdown(seconds)}>
            {!pauseOnChoice && `${c.auto} ${seconds}${c.seconds}`}
          </span>
          <button
            className="choice-pause"
            role="switch"
            aria-checked={pauseOnChoice}
            aria-label={c.choicePause}
            onClick={onTogglePause}
            disabled={!interactive}
          >
            <span className="choice-switch" aria-hidden="true">
              <span>
                <ControlIcon id={pauseOnChoice ? 'pause' : 'play'} />
              </span>
            </span>
          </button>
        </div>
      </div>
      <div className="cards" data-ready={pointerReady} ref={cards} onKeyDown={navigate}>
        {choice.cards.map((card) => {
          const { id, rarity } = card,
            rank = game.rank(id),
            text = c.upgrades[id];
          return (
            <button
              key={`${choice.number}-${id}`}
              className={`card ${id === automatic ? 'auto' : ''}`}
              data-rarity={rarity}
              data-upgrade={id}
              aria-label={[
                `${tag(card)} ${text.short}`.trim(),
                step(id),
                text.description,
                ...(id === automatic ? [c.auto] : []),
              ].join(', ')}
              onClick={(event) => accept(event) && onSelect(id, choice.number)}
              disabled={!interactive || !game.canUpgrade(id)}
            >
              <span className="card-label">
                {tag(card) && <b>{tag(card)}</b>}
                {id === automatic && <ControlIcon id="next" size={12} />}
              </span>
              <span className="card-icon">
                <SkillIcon id={id} size={32} />
                {isSkill(id) && <Rank value={rank} max={max} next={rank + 1} />}
              </span>
              <strong>{text.short}</strong>
              <span className="card-value" title={text.description}>
                {step(id)}
              </span>
              <span className="card-foot" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <div className="choice-track">
        <i
          style={{
            width:
              (pauseOnChoice ? 100 : (secondsLeft / game.rules.time.choiceSeconds) * 100) + '%',
          }}
        />
      </div>
    </section>
  );
}
