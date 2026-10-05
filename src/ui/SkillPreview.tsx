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
          {[0, 1, 2, 3].map((i) => {
            const angle = (i * Math.PI) / 2,
              x = Math.round(60 + Math.cos(angle) * radius * 0.8),
              y = Math.round(32 + Math.sin(angle) * radius * 0.8);
            return (
              <g key={i}>
                {bolt(
                  `M60 32 ${Math.round((60 + x) / 2) + 2} ${Math.round((32 + y) / 2) - 2} ${x} ${y}`,
                  undefined,
                  1,
                )}
              </g>
            );
          })}
          {origin}
          {target(60, 32, 4)}
          {bolt('M20 32h10l4-4 8 8 4-4h14')}
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
    case 'wave': {
      const radius =
        9 +
        (s.wave.radius / (rules.skills.wave.radii[rules.maxRank] * rules.rarity.legendary.scale)) *
          18;
      art = (
        <>
          {source(60, 32)}
          {target(60 + radius, 32, 0)}
          {target(60 - radius, 32, 1)}
          <circle className="preview-ring" cx="60" cy="32" r={radius} />
          <circle className="preview-ghost" cx="60" cy="32" r={radius} />
          <circle className="preview-ring preview-ripple" cx="60" cy="32" r={radius * 0.65} />
        </>
      );
      break;
    }
    case 'whip': {
      const length =
          45 +
          (s.whip.length /
            (rules.skills.whip.lengths[rules.maxRank] * rules.rarity.legendary.scale)) *
            35,
        points = [
          [0, 0],
          [0.16, -0.04],
          [0.3, -0.22],
          [0.48, -0.32],
          [0.7, -0.28],
          [0.84, -0.18],
          [0.82, 0.02],
          [0.7, 0.12],
          [0.58, 0.1],
          [0.52, 0.04],
          [0.6, -0.02],
          [0.7, 0.02],
          [0.78, 0.1],
        ].map(
          ([x, y]) =>
            `${Math.round((28 + x * length) / 2) * 2} ${Math.round((40 + y * length) / 2) * 2}`,
        ),
        d = `M${points.slice(0, 7).join('L')}`,
        tip = `M${points.slice(6).join('L')}`;
      art = (
        <>
          {source(28, 40)}
          {target(28 + length * 0.9, 28, 0)}
          {target(28 + length * 0.72, 51, 1)}
          <g
            className="preview-whip"
            style={{ '--arc': `${Math.round((s.whip.arc * 24) / Math.PI)}deg` } as CSSProperties}
          >
            <path className="preview-sheath" strokeWidth="7" d={d} />
            <path strokeWidth="4" d={d} />
            <path className="preview-hot" strokeWidth="2" d={d} />
            <path strokeWidth="2" d={tip} />
            <path className="preview-hot" strokeWidth="1" d={tip} />
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
