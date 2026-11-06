import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { Choice } from '../game/Game.ts';

// A pointer counts only if it went down after the cards had been up `guardMilliseconds`,
// so a tap meant for the arena does not pick the card that appears under it.
const guardMilliseconds = 300;
const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

export function useChoiceInput(choice: Choice | null, enabled: boolean) {
  const cards = useRef<HTMLDivElement>(null),
    opened = useRef(Infinity),
    press = useRef<{ button: Element; choice: Choice; allowed: boolean } | null>(null);
  const [pointerReady, setPointerReady] = useState(false);

  useEffect(() => {
    if (!choice || !enabled) return;
    (
      cards.current?.querySelector<HTMLButtonElement>('button.auto:not(:disabled)') ??
      cards.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    )?.focus({ preventScroll: true });
  }, [choice, enabled]);

  useLayoutEffect(() => {
    opened.current = performance.now();
    press.current = null;
    setPointerReady(false);
    if (!choice || !enabled) return;
    const timer = window.setTimeout(() => setPointerReady(true), guardMilliseconds);
    const down = (event: PointerEvent) => {
      const button = event.target instanceof Element ? event.target.closest('button.card') : null;
      if (!button || !cards.current?.contains(button)) return;
      const allowed = performance.now() - opened.current >= guardMilliseconds;
      press.current = { button, choice, allowed };
      if (!allowed) event.preventDefault();
    };
    window.addEventListener('pointerdown', down, { capture: true, passive: false });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', down, true);
    };
  }, [choice, enabled]);

  function accept(event: MouseEvent<HTMLButtonElement>): boolean {
    const p = press.current,
      pointer = event.detail > 0;
    press.current = null;
    const ok =
      enabled &&
      !!choice &&
      (pointer ? !!p?.allowed && p.choice === choice && p.button === event.currentTarget : true);
    if (!ok) event.preventDefault();
    return ok;
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>): void {
    // A key held from before the cards appeared only repeats; it never picks.
    if ((event.key === 'Enter' || event.key === ' ') && event.repeat) {
      event.preventDefault();
      return;
    }
    if (!keys.includes(event.key)) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement),
      step = event.key === 'ArrowRight' ? 1 : -1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (at + step + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus({ preventScroll: true });
  }

  return { cards, pointerReady, accept, navigate };
}
