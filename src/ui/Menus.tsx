import { Dialog } from './Dialog.tsx';
import { LanguagePicker, Notice, SoundToggle } from './Preferences.tsx';
import { copy } from './text/index.ts';
import type { useGame } from './useGame.ts';

type Controls = ReturnType<typeof useGame>;

export function Settings({ g, onClose }: { g: Controls; onClose: () => void }) {
  const c = copy[g.language];
  return (
    <Dialog titleId="settings-title" className="settings-panel">
      <div className="dialog-title">
        <h2 id="settings-title">{c.settings}</h2>
        <button className="text-button" onClick={onClose}>
          {c.close}
        </button>
      </div>
      <div className="dialog-body">
        <SoundToggle g={g} />
        <LanguagePicker g={g} />
        <Notice g={g} />
      </div>
    </Dialog>
  );
}

// The pause menu, or the question it turns into before a run is given up.
export function Pause({
  g,
  confirming,
  onResume,
  onOpen,
  onClose,
}: {
  g: Controls;
  confirming: boolean;
  onResume: () => void;
  onOpen: (panel: 'guide' | 'quit') => void;
  onClose: () => void;
}) {
  const c = copy[g.language];
  return (
    <Dialog
      titleId="pause-title"
      className={`pause-panel ${confirming ? 'is-confirming' : ''}`}
      focusKey={confirming ? 'quit' : 'pause'}
    >
      <div className="dialog-body">
        <h2 id="pause-title">{confirming ? c.quitTitle : c.pause}</h2>
        {confirming ? (
          <p>{g.game.endless ? c.quitBeyondNote : c.quitNote}</p>
        ) : (
          <>
            <SoundToggle g={g} />
            <LanguagePicker g={g} />
            <Notice g={g} />
          </>
        )}
      </div>
      <div className="dialog-actions">
        {confirming ? (
          <>
            <button
              className="text-button quit-button"
              onClick={() => {
                onClose();
                g.quit();
              }}
            >
              {c.quitConfirm}
            </button>
            <button className="primary" data-autofocus onClick={onClose}>
              {c.back}
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={onResume}>
              {c.resume}
            </button>
            <button className="text-button" onClick={() => onOpen('guide')}>
              {c.guide}
            </button>
            <button className="text-button" onClick={() => onOpen('quit')}>
              {c.quit}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
