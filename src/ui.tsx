import { CircleDot, FastForward, Gauge, GitFork, MoveUpRight, Orbit, Repeat2, Route, Sun, Waypoints, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { UpgradeId } from './rules.ts';
import { copy, languages } from './i18n.ts';
import type { Language } from './i18n.ts';

const skillIcons: Record<UpgradeId, LucideIcon> = { power: Zap, rate: FastForward, accel: Gauge, area: CircleDot, repeat: Repeat2, multi: GitFork, chain: Waypoints, pierce: MoveUpRight, satellite: Orbit, trail: Route, burst: Sun };
export function SkillIcon({ id, size = 24 }: { id: UpgradeId; size?: number }) {
  const Icon = skillIcons[id];
  return <Icon className="skill-icon" size={size} strokeWidth={size <= 16 ? 1.4 : 1.7} absoluteStrokeWidth aria-hidden="true" />;
}

export function Rank({ value }: { value: number }) {
  return <span className="rank" aria-hidden="true">{[1, 2, 3].map((n) => <i key={n} className={n <= value ? 'on' : ''} />)}</span>;
}

export function LanguagePicker({ value, onChange }: { value: Language; onChange: (language: Language) => void }) {
  return <div className="language-picker" role="group" aria-label={copy[value].language}>
    {languages.map(({ id, label, html }) => <button key={id} lang={html} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}
  </div>;
}

