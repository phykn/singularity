import { rules } from '../game/rules.ts';
import { copy, languages } from './i18n.ts';
import type { Language } from './i18n.ts';
export function Rank({ value, max = rules.maxRank }: { value: number; max?: number }) {
  return (
    <span className="rank" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <i key={n} className={n <= value ? 'on' : ''} />
      ))}
    </span>
  );
}

export function LanguagePicker({
  value,
  onChange,
}: {
  value: Language;
  onChange: (language: Language) => void;
}) {
  return (
    <div className="language-picker" role="group" aria-label={copy[value].language}>
      {languages.map(({ id, label, html }) => (
        <button key={id} lang={html} aria-pressed={value === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
