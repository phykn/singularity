import type { Settings as Preferences } from '../app/storage.ts';
import { copy } from './i18n.ts';
import type { Language } from './i18n.ts';
export function Settings({
  settings,
  language,
  toggleSound,
}: {
  settings: Preferences;
  language: Language;
  toggleSound: () => Promise<void>;
}) {
  const c = copy[language];
  return (
    <div className="settings-controls">
      <button
        className="setting-row"
        onClick={() => void toggleSound()}
        aria-label={c.sound + ' ' + (settings.sound ? c.on : c.off)}
        aria-pressed={settings.sound}
      >
        <span>{c.sound}</span>
        <span>
          {settings.sound ? c.on : c.off}
          <i className="switch" />
        </span>
      </button>
    </div>
  );
}
