import type { CSSProperties } from 'react';
import { blankRanks, blankRarities, formValues, rarityScale, rules } from '../game/rules.ts';
import type { Rarity, RuleSet, UpgradeId } from '../game/rules.ts';
import { skillColor } from '../render/palette.ts';

const delay = (index: number) => ({ '--delay': `${index * 0.13}s` }) as CSSProperties;
const target = (x: number, y: number, key: number) => (
  <g key={key} transform={`translate(${Math.round(x)} ${Math.round(y)})`} style={delay(key)}>
    <path className="preview-target" d="M-2-4h4v1h2v2h1v2H4v2H2v1h-4V3h-2V1h-1v-2h1v-2h2z" />
    <path fill="#b2c5cd" stroke="none" d="M-2-3h3v1h-2v2h-2v-2h1z" />
    <path className="preview-contact" d="M-2-5h4M4-3v2" />
  </g>
);
const source = (x: number, y: number) => (
  <g className="preview-source" transform={`translate(${x} ${y})`}>
    <path fill="#367c9b" d="M-2-6h4v1h2v1h1v2h1v4H5v2H4v1H2v1h-4V5h-2V4h-1V2h-1v-4h1v-2h1v-1h2z" />
    <path fill="#91eafd" d="M-2-5h4v1h2v2h1v4H4v2H1v1h-3V4h-2V2h-1v-4h1v-2h2z" />
    <path fill="#f1fcff" d="M-2-3h3v1h1v3H1v1h-3V1h-1v-3h1z" />
  </g>
);
const bolt = (d: string, style?: CSSProperties, width = 2) => (
  <g className="preview-bolt" style={style}>
    <path className="preview-sheath" d={d} strokeWidth={width + 4} />
    <path d={d} strokeWidth={width + 1} />
    <path className="preview-hot" d={d} strokeWidth={Math.max(1, width - 1)} />
  </g>
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
  const origin = source(16, 32);
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
          {bolt('M20 32 45 25 52 39 76 26 99 32', undefined, Math.min(8, 1 + rank * scale))}
        </>
      );
      break;
    case 'rate':
      art = (
        <>
          {origin}
          {target(102, 32, 0)}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              {bolt(`M20 ${22 + i * 10}h23l8 -5 13 10 12 -5h23`, {
                ...delay(i),
                animationDuration: `${Math.max(0.6, 1.3 / (1 + rank * rules.ratePerRank * scale))}s`,
              })}
            </g>
          ))}
        </>
      );
      break;
    case 'range':
      art = (
        <>
          {origin}
          <path className="preview-ghost" d="M51 9v8m0 30v8M19 52h78m-5-4 5 4-5 4" />
          {target(53, 27, 0)}
          {target(105, 32, 1)}
          {bolt('M20 32h34l8-6 13 12 13-6h14')}
        </>
      );
      break;
    case 'recover':
      art = (
        <>
          <circle className="preview-ghost" cx="60" cy="32" r="14" />
          <circle className="preview-ghost" cx="60" cy="32" r="25" />
          {target(60, 32, 0)}
          <g className="preview-restore">
            <path d="M60 7a25 25 0 1 1-25 25" />
            {source(85, 32)}
          </g>
          <path d="M72 32h20m-4-4 4 4-4 4" />
        </>
      );
      break;
    case 'burst': {
      const count = s.burst.count,
        radius =
          12 +
          (s.burst.radius /
            (rules.skills.burst.radii[rules.maxRank] * rules.rarity.legendary.scale)) *
            16;
      art = (
        <>
          <path className="preview-ghost" d="M58 27h4v2h3v6h-3v2h-4v-2h-3v-6h3z" />
          {Array.from({ length: count }, (_, i) => {
            const angle = (i * Math.PI * 2) / count,
              x = Math.round(60 + Math.cos(angle) * radius),
              y = Math.round(32 + Math.sin(angle) * radius);
            return (
              <g key={i}>
                {target(x, y, i)}
                {bolt(
                  `M60 32 ${Math.round((60 + x) / 2) + 3} ${Math.round((32 + y) / 2) - 3} ${x} ${y}`,
                )}
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
            const x = s.strike.count === 1 ? 60 : Math.round(18 + (i * 84) / (s.strike.count - 1));
            return (
              <g key={i}>
                {target(x, 50, i)}
                {bolt(`M${x} 7l-5 13h8l-6 17h6l-3 13`, delay(i), 3)}
                <path className="preview-contact" style={delay(i)} d={`M${x - 8} 53h4m8 0h4`} />
              </g>
            );
          })}
        </>
      );
      break;
    case 'repel':
      art = (
        <>
          {origin}
          {target(73, 21, 0)}
          {target(83, 45, 1)}
          {bolt('M20 32 38 24 44 32 70 21')}
          {bolt('M20 32 44 42 52 36 80 45')}
          <path className="preview-contact" d="M85 20h20m-4-4 4 4-4 4M95 44h15m-4-4 4 4-4 4" />
        </>
      );
      break;
    case 'orb':
      art = (
        <>
          {origin}
          <path className="preview-ghost" d="M24 32h80" />
          {target(79, 14, 0)}
          {target(91, 50, 1)}
          <g className="preview-orb">
            {source(53, 32)}
            {bolt('M56 29 64 20 70 24 76 14')}
            {bolt('M56 35 67 42 76 37 88 50')}
          </g>
        </>
      );
      break;
    case 'charge':
      art = (
        <>
          {origin}
          {target(98, 32, 0)}
          {bolt('M20 32 42 24 50 39 70 28 95 32', undefined, 1)}
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              className="preview-bolt"
              style={delay(i)}
              x={88 + i * 7}
              y="16"
              width="4"
              height="4"
              fill="currentColor"
              stroke="none"
            />
          ))}
          {bolt('M20 32h30l8-9 9 15 28-6', { '--delay': '.65s' } as CSSProperties, 4)}
        </>
      );
      break;
    case 'bridge':
      art = (
        <>
          {target(24, 42, 0)}
          {target(96, 22, 1)}
          <path className="preview-ghost" d="M60 8v46m-4-4 4 4 4-4" />
          {target(60, 32, 2)}
          {bolt('M24 42 39 32 48 36 61 27 70 32 96 22', undefined, 1)}
          <rect x="21" y="39" width="5" height="5" fill="currentColor" />
          <rect x="93" y="19" width="5" height="5" fill="currentColor" />
        </>
      );
      break;
    case 'gather':
      art = (
        <>
          {target(62, 32, 0)}
          {target(27, 14, 1)}
          {target(28, 50, 2)}
          {target(103, 32, 3)}
          {bolt('M29 16 44 20 42 26 58 30', undefined, 1)}
          {bolt('M30 48 44 42 40 38 58 34', delay(1), 1)}
          {bolt('M100 32 85 26 81 35 66 32', delay(2), 1)}
          <path d="m49 24 8 6-9 1m28-4-8 5 9 3" />
        </>
      );
      break;
    case 'stun':
      art = (
        <>
          {origin}
          {target(94, 32, 0)}
          {bolt('M20 32h24l6-8 7 15 11-7h23')}
          <path className="preview-flash" d="M83 21v22m22-22v22M90 15l4-5 3 7 4-5" />
        </>
      );
      break;
    case 'chase':
      art = (
        <>
          {origin}
          {target(70, 16, 0)}
          {target(101, 43, 1)}
          <path className="preview-ghost" d="M63 7h14m17 25h14" />
          <path stroke="#e59a9a" d="M94 25h4" />
          {bolt('M20 32 49 37 62 32 79 46 98 43', undefined, 2)}
        </>
      );
      break;
    case 'surge':
      art = (
        <>
          {source(40, 32)}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              {target(100, 12 + i * 20, i)}
              {bolt(`M45 32 63 ${18 + i * 12} 76 ${24 + i * 8} 97 ${12 + i * 20}`, delay(i), 1)}
            </g>
          ))}
          <path className="preview-flash" d="M31 20l4-6m-9 18h-6m11 12 4 6" />
        </>
      );
      break;
    case 'return':
      art = (
        <>
          {source(18, 46)}
          <path className="preview-ghost" d="M18 14v23m-4-5 4 5 4-5M18 14h74" />
          {target(99, 16, 0)}
          {target(58, 37, 1)}
          {bolt('M97 18 78 23 82 30 57 37 41 34 23 45', { '--delay': '.3s' } as CSSProperties)}
          <path d="m30 38-7 7 9 1" />
        </>
      );
      break;
    case 'focus':
      art = (
        <>
          {origin}
          {target(100, 32, 0)}
          <g className="preview-focus" style={{ animationDuration: `${s.focus.duration + 0.8}s` }}>
            <path className="preview-beam" strokeWidth={3 + rank} d="M18 32h80" />
            <path strokeWidth="3" d="M20 32h20l4-3 8 6 4-3h42" />
            <path className="preview-hot" strokeWidth="1" d="M20 32h78" />
            <path className="preview-contact" d="M98 23h4m6 7v4m-6 7h-4" />
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
            <g key={i}>
              {bolt(`M20 32 42 ${20 + (i % 2) * 4}h12l-8 20h15L99 32`, {
                '--delay': `${i * rules.skills.repeat.delaySeconds}s`,
              } as CSSProperties)}
            </g>
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
                {bolt(
                  `M20 32 49 ${Math.round(32 + (y - 32) * 0.35 - 5)} 58 ${Math.round(32 + (y - 32) * 0.55 + 4)} 97 ${Math.round(y)}`,
                )}
              </g>
            );
          })}
        </>
      );
      break;
    case 'chain': {
      const points = Array.from({ length: s.chain.hops + 1 }, (_, i) => [
        Math.round(10 + (i * 100) / s.chain.hops),
        i % 2 ? 16 : 44,
      ]);
      art = (
        <>
          {points.map(([x, y], i) => (
            <g key={i}>
              {target(x, y, i)}
              {i > 0 &&
                (() => {
                  const [px, py] = points[i - 1],
                    dx = x - px,
                    dy = y - py,
                    mx = Math.round(px + dx * 0.45),
                    my = Math.round(py + dy * 0.45);
                  return bolt(
                    `M${px} ${py} ${mx - 3} ${my + 4} ${mx + 4} ${my - 3} ${Math.round(px + dx * 0.75)} ${Math.round(py + dy * 0.75)} ${x} ${y}`,
                    delay(i - 1),
                  );
                })()}
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
          {bolt(`M20 32h${Math.round(length) - 1}`)}
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
