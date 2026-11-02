import type { CSSProperties } from 'react';
import type { Game } from '../game/Game.ts';
import { skillColor } from '../art/palette.ts';
import { isPact } from '../game/rules.ts';
import { SkillIcon } from './icons.tsx';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function UpgradeFeedback({ game, language }: { game: Game; language: Language }) {
  const id = game.notice;
  if (!id || game.time >= game.noticeUntil || game.phase !== 'running') return null;
  const rank = game.rank(id),
    c = copy[language],
    evolve = game.selections.at(-1)?.evolve;
  const change =
    id === 'recover'
      ? c.instant
      : evolve
        ? c.evolve
        : isPact(id)
          ? c.pact
          : rank === 1
            ? 'Lv. 1'
            : `${rank - 1} → ${rank}`;
  return (
    <div
      className="upgrade-feedback"
      key={game.selections.length}
      style={{ '--skill': skillColor(id) } as CSSProperties}
      data-skill={id}
      role="status"
      aria-label={
        c.upgrades[id].name +
        ', ' +
        (id === 'recover' || evolve || isPact(id) ? change : c.rankUp(rank - 1, rank))
      }
    >
      <SkillIcon id={id} size={16} />
      <strong>{c.upgrades[id].short}</strong>
      <span>{change}</span>
    </div>
  );
}
