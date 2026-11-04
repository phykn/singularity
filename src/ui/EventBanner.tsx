import type { Game } from '../game/Game.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';
import type { BannerKind } from '../game/types.ts';
import type { BossKind } from '../game/bosses.ts';

export function bannerText(language: Language, kind: BannerKind, boss?: BossKind): string {
  const c = copy[language],
    name = boss ? c.bossNames[boss] : c.bossName;
  return c.banners[kind].replace('{name}', name).replace('{NAME}', name.toUpperCase());
}

export function EventBanner({ game, language }: { game: Game; language: Language }) {
  const banner = game.banner;
  if (!banner || game.time >= banner.until || game.phase !== 'running') return null;
  return (
    <div className="event-banner" data-kind={banner.kind} role="status" key={banner.kind}>
      {bannerText(language, banner.kind, banner.boss)}
      {banner.kind === 'boss' && ` ${game.bossCount}/${game.rules.boss.stages.length}`}
    </div>
  );
}
