import type { Game } from '../game/Game.ts';
import { isPact, isSkill, isStat } from '../game/rules.ts';
import type { Card, UpgradeId } from '../game/rules.ts';
import { ControlIcon, Rank, SkillIcon } from './icons.tsx';
import { pactText, skillChange, skillLinks } from './skillText.ts';
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
  const tag = ({ id, rarity, evolve }: Card) =>
    evolve ? c.evolve : isPact(id) ? c.pact : isStat(id) ? '' : c.rarities[rarity];
  // The headline, what the pick changes, the long description and the foot of each card.
  const words = ({ id, rarity, evolve }: Card) => {
    if (evolve && isSkill(id)) {
      const e = c.evolutions[id];
      return { title: e.name, value: e.summary, description: e.description, cost: '', links: [] };
    }
    const rank = game.rank(id),
      links = isSkill(id) ? skillLinks(id, game.ownedSkills) : [];
    if (isPact(id)) {
      const { gain, cost } = pactText(id, c, game.rules.pacts);
      return {
        title: c.upgrades[id].short,
        value: gain,
        description: c.upgrades[id].description,
        cost,
        links,
      };
    }
    const prior = game.rarities[id] ?? rarity;
    return {
      title: c.upgrades[id].short,
      value: skillChange(id, rank, rarity, prior, c, game.rules, game.mass),
      description: c.upgrades[id].description,
      stage:
        id === 'recover' ? c.instant : rank || !isSkill(id) ? c.rankUp(rank, rank + 1) : c.newSkill,
      cost: '',
      links,
    };
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
          const { id, rarity, evolve } = card,
            rank = game.rank(id),
            text = words(card);
          return (
            <button
              key={`${choice.number}-${id}`}
              className={`card ${id === automatic ? 'auto' : ''}`}
              data-rarity={rarity}
              data-upgrade={id}
              data-evolve={!!evolve}
              data-pact={isPact(id)}
              aria-label={[
                `${tag(card)} ${text.title}`.trim(),
                ...(text.stage ? [text.stage] : []),
                text.value,
                ...(text.cost ? [text.cost] : []),
                ...text.links.map(
                  (link) => `${c.link}: ${c.upgrades[link.skill].name} ${c.links[link.effect]}`,
                ),
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
                <SkillIcon id={id} size={32} evolved={evolve} />
                {isSkill(id) && !evolve && <Rank value={rank} max={max} next={rank + 1} />}
              </span>
              <strong>{text.title}</strong>
              <span className="card-value" title={text.description}>
                {text.value}
              </span>
              <span className={`card-foot ${text.cost ? 'pact-cost' : ''}`} aria-hidden="true">
                {text.cost ||
                  (text.links.length > 0 && (
                    <>
                      {text.links.map((link) => (
                        <SkillIcon key={link.skill} id={link.skill} size={16} />
                      ))}
                      <span>
                        {text.links.length === 1 ? c.links[text.links[0].effect] : c.link}
                      </span>
                    </>
                  )) ||
                  (isStat(id) && `${rank}→${rank + 1}`)}
              </span>
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
