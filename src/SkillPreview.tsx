import type { CSSProperties } from 'react';
import { blankRanks, blankRarities, formValues, rarityScale, rules } from './rules.ts';
import type { Rarity, RuleSet, UpgradeId } from './rules.ts';

const delay = (index: number) => ({ '--delay': `${index * 0.13}s` }) as CSSProperties;
const target = (x: number, y: number, key: number) => <rect key={key} className="preview-target" x={x - 3} y={y - 3} width="6" height="6" rx="1" />;

export function SkillPreview({ id, rank, rarity = 'common', cfg = rules }: { id: UpgradeId; rank: number; rarity?: Rarity; cfg?: RuleSet }) {
  const rules = cfg;
  const s = formValues({ ...blankRanks(), [id]: rank }, { ...blankRarities(), [id]: rarity }, cfg);
  const scale = rarityScale(rarity, cfg);
  const origin = <circle className="preview-source" cx="16" cy="32" r="3" />;
  let art;
  switch (id) {
    case 'power':
      art = <>{origin}{target(102, 32, 0)}<path className="preview-beam" strokeWidth={3 + rank * scale * 3} d="M20 32 45 25 52 39 76 26 99 32" /><path className="preview-bolt" strokeWidth={1 + rank * scale} d="M20 32 45 25 52 39 76 26 99 32" /></>;
      break;
    case 'rate':
      art = <>{origin}{target(102, 32, 0)}{[0, 1, 2].map((i) => <path key={i} className="preview-bolt" style={{ ...delay(i), animationDuration: `${1.3 / (1 + rank * rules.ratePerRank * scale)}s` }} d={`M20 ${22 + i * 10}h23l8 -5 13 10 12 -5h23`} />)}</>;
      break;
    case 'accel':
      art = <><circle className="preview-ghost" cx="60" cy="32" r="14" /><circle className="preview-ghost" cx="60" cy="32" r="25" /><circle cx="60" cy="32" r="4" className="preview-target" /><g className="preview-orbit" style={{ animationDuration: `${3 / (1 + rank * rules.speedPerRank * scale)}s` }}><path d="M60 7a25 25 0 0 1 25 25" /><circle className="preview-source" cx="85" cy="32" r="3" /></g></>;
      break;
    case 'area':
    case 'burst': {
      const base = id === 'area' ? rules.skills.area.radii : rules.skills.burst.radii;
      const radius = s[id].radius / (base[rules.maxRank] * rules.rarity.legendary.scale) * 27;
      art = <>
        {[[-18, -13], [17, 10], [6, -22]].map(([x, y], i) => target(60 + x, 32 + y, i))}
        {rank > 1 && <circle className="preview-ghost" cx="60" cy="32" r={base[rank - 1] * scale / (base[3] * rules.rarity.legendary.scale) * 27} />}
        <circle className="preview-ghost" cx="60" cy="32" r={radius} />
        <circle className="preview-ring" cx="60" cy="32" r={radius} />
        {id === 'burst' && <g className="preview-flash"><path d="m60 7 0 7m0 36v7M35 32h7m36 0h7M42 14l5 5m26 26 5 5m-36 0 5-5m26-26 5-5" /></g>}
        <circle className="preview-source" cx="60" cy="32" r="3" />
      </>;
      break;
    }
    case 'repeat':
      art = <>{origin}{target(102, 32, 0)}{Array.from({ length: s.repeat.hits }, (_, i) => <path className="preview-bolt" key={i} style={delay(i)} d={`M20 32 44 ${25 + i * 3} 53 ${39 - i * 3} 75 27 99 32`} />)}</>;
      break;
    case 'multi':
      art = <>{origin}{Array.from({ length: s.multi.count }, (_, i) => {
        const y = 9 + i * 46 / (s.multi.count - 1);
        return <g key={i}>{target(100, y, i)}<path className="preview-bolt" d={`M20 32 49 ${32 + (y - 32) * .35 - 5} 58 ${32 + (y - 32) * .55 + 4} 97 ${y}`} /></g>;
      })}</>;
      break;
    case 'chain': {
      const points = Array.from({ length: s.chain.hops + 1 }, (_, i) => [10 + i * 100 / s.chain.hops, i % 2 ? 16 : 44]);
      art = <>{points.map(([x, y], i) => <g key={i}>{target(x, y, i)}{i > 0 && <path className="preview-bolt" style={delay(i - 1)} d={`M${points[i - 1][0]} ${points[i - 1][1]} ${x} ${y}`} />}</g>)}</>;
      break;
    }
    case 'pierce': {
      const length = 56 + s.pierce.length / (rules.skills.pierce.lengths[rules.maxRank] * rules.rarity.legendary.scale) * 32;
      art = <>{origin}{target(46, 32, 0)}{target(19 + length * .8, 32, 1)}<path className="preview-beam" strokeWidth={s.pierce.width * .4} d={`M19 32h${length}`} /><path className="preview-bolt" d={`M19 32h${length}`} /></>;
      break;
    }
    case 'satellite':
      art = <><circle className="preview-ghost" cx="60" cy="32" r="21" /><circle className="preview-source" cx="60" cy="32" r="4" /><g className="preview-orbit">{Array.from({ length: s.satellite.count }, (_, i) => { const angle = i * Math.PI * 2 / s.satellite.count; return <circle key={i} className="preview-source satellite-dot" cx={60 + Math.cos(angle) * 21} cy={32 + Math.sin(angle) * 21} r="3" />; })}</g></>;
      break;
    case 'trail':
      art = <><path className="preview-ghost" d="M14 48C52 48 52 16 102 16" />{Array.from({ length: Math.ceil(s.trail.lifetime / .25) }, (_, i) => <circle key={i} className="preview-trail" style={delay(i)} cx={20 + i * 75 / Math.ceil(s.trail.lifetime / .25)} cy={46 - i * 30 / Math.ceil(s.trail.lifetime / .25)} r={s.trail.radius * .3} />)}<circle className="preview-source" cx="102" cy="16" r="3" /></>;
      break;
  }
  return <svg className={`skill-preview preview-${id}`} viewBox="0 0 120 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{art}</svg>;
}
