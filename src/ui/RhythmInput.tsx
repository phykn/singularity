import { useEffect } from 'react';
import type { Rhythm } from '../session/rhythm.ts';
import { copy } from './text/index.ts';
import type { Language } from './text/index.ts';

// The arena-sized tap target while a beat round runs; Space and Enter tap too.
export function RhythmInput({
  rhythm,
  language,
  onTap,
}: {
  rhythm: Rhythm;
  language: Language;
  onTap: () => void;
}) {
  const c = copy[language];
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!rhythm.active || !['Space', 'Enter'].includes(event.code) || event.defaultPrevented)
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, select, textarea, [contenteditable]')
      )
        return;
      event.preventDefault();
      if (!event.repeat) onTap();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [rhythm, onTap]);

  if (!rhythm.active) return null;
  return (
    <button
      className="rhythm-input"
      aria-label={c.rhythmTap}
      aria-describedby="rhythm-help"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.dataset.input = 'pointer';
        event.currentTarget.focus({ preventScroll: true });
        onTap();
      }}
      onKeyDown={(event) => {
        if (!['Space', 'Enter'].includes(event.code)) return;
        event.preventDefault();
        event.currentTarget.dataset.input = 'keyboard';
        if (!event.repeat) onTap();
      }}
      onClick={(event) => {
        if (event.detail === 0) onTap();
      }}
    >
      <span id="rhythm-help" className="sr-only">
        {c.guideRhythm}
      </span>
      {rhythm.completed === 0 && (
        <span className="rhythm-hint" aria-hidden="true">
          {c.rhythmTap}
        </span>
      )}
    </button>
  );
}
