import type { Game } from '../game/Game.ts';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

// Giants, the critical breach and the Higgs announce themselves for a few seconds.
export function EventBanner({ game, language }: { game: Game; language: Language }) {
  const banner = game.banner;
  if (!banner || game.time >= banner.until || game.phase !== 'running') return null;
  const c = copy[language],
    name = banner.boss ? c.bossNames[banner.boss] : c.bossName;
  return (
    <div className="event-banner" data-kind={banner.kind} role="status" key={banner.kind}>
      {c.banners[banner.kind].replace('{name}', name).replace('{NAME}', name.toUpperCase())}
      {banner.kind === 'boss' && ` ${game.giants.count}/${game.rules.bosses.length}`}
    </div>
  );
}
