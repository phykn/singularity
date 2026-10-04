import type { CSSProperties } from 'react';
import { blankRanks, blankRarities, formValues, rarityScale, rules } from '../game/rules.ts';
import type { Rarity, RuleSet, UpgradeId } from '../game/rules.ts';
import { skillColor } from '../render/palette.ts';

const delay = (index: number) => ({ '--delay': `${index * 0.13}s` }) as CSSProperties;
const target = (x: number, y: number, key: number) => (
  <rect
    key={key}
    className="preview-target"
    x={Math.round(x) - 3}
    y={Math.round(y) - 3}
    width="6"
    height="6"
  />
);

export function SkillPreview({
  id,
  rank,
  rarity = 'common',
  cfg = rules,
}: {
  id: UpgradeId;
  rank: number;
  rarity?: Rarity;
  cfg?: RuleSet;
}) {
  const rules = cfg;
  const s = formValues({ ...blankRanks(), [id]: rank }, { ...blankRarities(), [id]: rarity }, cfg);
  const scale = rarityScale(rarity, cfg);
  const origin = <path className="preview-source" d="M14 28h4v2h2v4h-2v2h-4v-2h-2v-4h2z" />;
  let art;
  switch (id) {
    case 'power':
      art = (
        <>
          {origin}
          {target(102, 32, 0)}
          <path
            className="preview-beam"
            strokeWidth={Math.min(24, 3 + rank * scale * 3)}
            d="M20 32 45 25 52 39 76 26 99 32"
          />
          <path
            className="preview-bolt"
            strokeWidth={Math.min(8, 1 + rank * scale)}
            d="M20 32 45 25 52 39 76 26 99 32"
          />
        </>
      );
      break;
    case 'rate':
      art = (
        <>
          {origin}
          {target(102, 32, 0)}
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              className="preview-bolt"
              style={{
                ...delay(i),
                animationDuration: `${Math.max(0.6, 1.3 / (1 + rank * rules.ratePerRank * scale))}s`,
              }}
              d={`M20 ${22 + i * 10}h23l8 -5 13 10 12 -5h23`}
            />
          ))}
        </>
      );
      break;
    case 'accel':
      art = (
        <>
          <circle className="preview-ghost" cx="60" cy="32" r="14" />
          <circle className="preview-ghost" cx="60" cy="32" r="25" />
          <circle cx="60" cy="32" r="4" className="preview-target" />
          <g
            className="preview-orbit"
            style={{
              animationDuration: `${Math.max(0.8, 3 / (1 + rank * rules.speedPerRank * scale))}s`,
            }}
          >
            <path d="M60 7a25 25 0 0 1 25 25" />
            <circle className="preview-source" cx="85" cy="32" r="3" />
          </g>
        </>
      );
      break;
    case 'area': {
      const base = rules.skills.area.radii;
      const radius = (s[id].radius / (base[rules.maxRank] * rules.rarity.legendary.scale)) * 27;
      art = (
        <>
          {[
            [-18, -13],
            [17, 10],
            [6, -22],
          ].map(([x, y], i) => target(60 + x, 32 + y, i))}
          {rank > 1 && (
            <circle
              className="preview-ghost"
              cx="60"
              cy="32"
              r={
                ((base[rank - 1] * scale) / (base[rules.maxRank] * rules.rarity.legendary.scale)) *
                27
              }
            />
          )}
          <circle className="preview-ghost" cx="60" cy="32" r={radius} />
          <circle className="preview-ring" cx="60" cy="32" r={radius} />
          {origin}
          {target(60, 32, 4)}
          <path className="preview-bolt" d="M18 32h12l4-4 8 8 4-4h14" />
        </>
      );
      break;
    }
    case 'burst': {
      const count = s.burst.count,
        radius =
          12 +
          (s.burst.radius /
            (rules.skills.burst.radii[rules.maxRank] * rules.rarity.legendary.scale)) *
            16;
      art = (
        <>
          <path className="preview-target" d="m56 28 8 8m-8 0 8-8" />
          {Array.from({ length: count }, (_, i) => {
            const angle = (i * Math.PI * 2) / count,
              x = Math.round(60 + Math.cos(angle) * radius),
              y = Math.round(32 + Math.sin(angle) * radius);
            return (
              <g key={i}>
                {target(x, y, i)}
                <path
                  className="preview-bolt"
                  d={`M60 32 ${Math.round((60 + x) / 2) + 3} ${Math.round((32 + y) / 2) - 3} ${x} ${y}`}
                />
              </g>
            );
          })}
        </>
      );
      break;
    }
    case 'strike':
      art = (
        <>
          {Array.from({ length: s.strike.count }, (_, i) => {
            const x = Math.round(18 + (i * 84) / Math.max(1, s.strike.count - 1));
            return (
              <g key={i}>
                {target(x, 50, i)}
                <path
                  className="preview-bolt"
                  style={delay(i)}
                  strokeWidth="3"
                  d={`M${x} 4l-5 16h8l-6 17h6l-3 13`}
                />
              </g>
            );
          })}
        </>
      );
      break;
    case 'wave': {
      const radius =
        9 +
        (s.wave.radius / (rules.skills.wave.radii[rules.maxRank] * rules.rarity.legendary.scale)) *
          18;
      art = (
        <>
          <rect className="preview-source" x="57" y="29" width="6" height="6" />
          {target(60 + radius, 32, 0)}
          {target(60 - radius, 32, 1)}
          <circle className="preview-ring" cx="60" cy="32" r={radius} />
          <circle className="preview-ghost" cx="60" cy="32" r={radius} />
        </>
      );
      break;
    }
    case 'whip': {
      const length =
        12 +
        (s.whip.length /
          (rules.skills.whip.lengths[rules.maxRank] * rules.rarity.legendary.scale)) *
          18;
      art = (
        <>
          <rect className="preview-source" x="43" y="29" width="6" height="6" />
          {target(46 + length, 32, 0)}
          {target(46 + length * 0.7, 32 + length * 0.7, 1)}
          <g
            className="preview-whip"
            style={{ '--arc': `${Math.round((s.whip.arc * 180) / Math.PI)}deg` } as CSSProperties}
          >
            <path
              d={`M46 32h${Math.round(length * 0.4)}l3 -3 5 6 3-3h${Math.round(length * 0.6) - 11}`}
            />
          </g>
        </>
      );
      break;
    }
    case 'focus':
      art = (
        <>
          {origin}
          {target(100, 32, 0)}
          <g className="preview-focus" style={{ animationDuration: `${s.focus.duration + 0.8}s` }}>
            <path className="preview-beam" strokeWidth={3 + rank} d="M18 32h80" />
            <path d="M18 32h22l4-3 8 6 4-3h42" />
            <rect className="preview-source" x="96" y="28" width="8" height="8" />
          </g>
        </>
      );
      break;
    case 'repeat':
      art = (
        <>
          {origin}
          {target(102, 32, 0)}
          {Array.from({ length: s.repeat.hits }, (_, i) => (
            <path
              className="preview-bolt"
              key={i}
              style={delay(i)}
              d={`M20 32 44 ${25 + i * 3} 53 ${39 - i * 3} 75 27 99 32`}
            />
          ))}
        </>
      );
      break;
    case 'multi':
      art = (
        <>
          {origin}
          {Array.from({ length: s.multi.count }, (_, i) => {
            const y = 9 + (i * 46) / (s.multi.count - 1);
            return (
              <g key={i}>
                {target(100, y, i)}
                <path
                  className="preview-bolt"
                  d={`M20 32 49 ${32 + (y - 32) * 0.35 - 5} 58 ${32 + (y - 32) * 0.55 + 4} 97 ${y}`}
                />
              </g>
            );
          })}
        </>
      );
      break;
    case 'chain': {
      const points = Array.from({ length: s.chain.hops + 1 }, (_, i) => [
        10 + (i * 100) / s.chain.hops,
        i % 2 ? 16 : 44,
      ]);
      art = (
        <>
          {points.map(([x, y], i) => (
            <g key={i}>
              {target(x, y, i)}
              {i > 0 && (
                <path
                  className="preview-bolt"
                  style={delay(i - 1)}
                  d={`M${points[i - 1][0]} ${points[i - 1][1]} ${x} ${y}`}
                />
              )}
            </g>
          ))}
        </>
      );
      break;
    }
    case 'pierce': {
      const length =
        56 +
        (s.pierce.length /
          (rules.skills.pierce.lengths[rules.maxRank] * rules.rarity.legendary.scale)) *
          32;
      art = (
        <>
          {origin}
          {target(46, 32, 0)}
          {target(19 + length * 0.8, 32, 1)}
          <path
            className="preview-beam"
            strokeWidth={s.pierce.width * 0.4}
            d={`M19 32h${length}`}
          />
          <path className="preview-bolt" d={`M19 32h${length}`} />
        </>
      );
      break;
    }
  }
  return (
    <svg
      className={`skill-preview preview-${id}`}
      style={{ color: skillColor(id) }}
      viewBox="0 0 120 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {art}
    </svg>
  );
}
