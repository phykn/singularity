import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';

export function EventBanner({ game, language }: { game: Game; language: Language }) {
  const banner = game.banner;
  if (!banner || game.time >= banner.until || game.phase !== 'running') return null;
  return (
    <div className="event-banner" data-kind={banner.kind} role="status" key={banner.kind}>
      {copy[language].banners[banner.kind]}
    </div>
  );
}
