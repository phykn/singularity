import { ArrowUp, Circle, Cloud, CornerUpRight, GitBranch, GitMerge, Link, Repeat, SpeedFast, Target, Waves, Zap } from 'pixelarticons/react';
import type { ComponentType, SVGProps } from 'react';
import { rules } from './rules.ts';
import type { UpgradeId } from './rules.ts';
import { copy, languages } from './i18n.ts';
import type { Language } from './i18n.ts';

const skillIcons: Record<UpgradeId, ComponentType<SVGProps<SVGSVGElement>>> = { power: Zap, rate: Repeat, accel: SpeedFast, area: Circle, repeat: Repeat, multi: GitBranch, chain: Link, pierce: ArrowUp, burst: GitMerge, strike: Cloud, wave: Waves, whip: CornerUpRight, focus: Target };
export function SkillIcon({ id, size = 24 }: { id: UpgradeId; size?: number }) {
  const Icon = skillIcons[id];
  const pixels = size <= 16 ? 12 : 24;
  return <Icon className="skill-icon" width={pixels} height={pixels} aria-hidden="true" />;
}

export function Rank({ value, max = rules.maxRank }: { value: number; max?: number }) {
  return <span className="rank" aria-hidden="true">{Array.from({ length: max }, (_, i) => i + 1).map((n) => <i key={n} className={n <= value ? 'on' : ''} />)}</span>;
}

export function LanguagePicker({ value, onChange }: { value: Language; onChange: (language: Language) => void }) {
  return <div className="language-picker" role="group" aria-label={copy[value].language}>
    {languages.map(({ id, label, html }) => <button key={id} lang={html} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}

