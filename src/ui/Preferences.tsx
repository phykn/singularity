import { SoundIcon } from './icons.tsx';
import { copy, languages } from './text/index.ts';
import type { useGame } from './useGame.ts';

type Controls = ReturnType<typeof useGame>;

// Sound, language and the notice for a setting that could not take effect; shown on the
// title, in settings and in the pause menu.
export function SoundToggle({ g }: { g: Controls }) {
  const c = copy[g.language];
  return (
    <button
      className="title-sound"
      onClick={g.toggleSound}
      aria-label={`${c.sound} ${g.sound ? c.on : c.off}`}
      aria-pressed={g.sound}
    >
      <SoundIcon enabled={g.sound} />
      <span className="title-sound-label">
        <span>{c.sound}</span>
      </span>
      <span className="title-sound-state">{g.sound ? c.on : c.off}</span>
      <i className="switch" aria-hidden="true" />
    </button>
  );
}

export function LanguagePicker({ g }: { g: Controls }) {
  return (
    <div className="language-picker" role="group" aria-label={copy[g.language].language}>
      {languages.map(({ id, label, html }) => (
        <button
          key={id}
          lang={html}
          aria-pressed={g.language === id}
          onClick={() => g.changeLanguage(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ g }: { g: Controls }) {
  const c = copy[g.language];
  if (!g.audioFailed && !g.storageFailed) return null;
  return (
    <p className="setting-notice" role="status">
      {g.audioFailed ? c.audioFailed : c.storageFailed}
    </p>
  );
}
