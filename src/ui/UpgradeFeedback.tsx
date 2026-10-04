import type { CSSProperties } from 'react';
import type { Game } from '../game/model.ts';
import { skillColor } from '../render/palette.ts';
import { SkillIcon } from './icons.tsx';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function UpgradeFeedback({ game, language }: { game: Game; language: Language }) {
  const id = game.notice;
  if (!id || game.time >= game.noticeUntil || game.phase !== 'running') return null;
  const rank = game.rank(id),
    c = copy[language];
  return (
    <div
      className="upgrade-feedback"
      style={{ '--skill': skillColor(id) } as CSSProperties}
      data-skill={id}
      role="status"
      aria-label={c.upgrades[id].name + ', ' + c.rankUp(rank - 1, rank)}
    >
      <SkillIcon id={id} size={16} />
      <strong>{c.upgrades[id].short}</strong>
      <span>{rank === 1 ? 'Lv. 1' : `${rank - 1} → ${rank}`}</span>
    </div>
  );
}
