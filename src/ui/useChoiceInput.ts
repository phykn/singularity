import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { Choice } from '../game/types.ts';
import { ChoiceInput } from './ChoiceInput.ts';

export function useChoiceInput(choice: Choice | null, enabled: boolean) {
  const cards = useRef<HTMLDivElement>(null);
  const [input] = useState(() => new ChoiceInput());
  const [pointerReady, setPointerReady] = useState(false);
  const press = useRef<{ button: HTMLButtonElement; choice: Choice; pointer: number } | null>(null);
  const click = useRef<{ button: HTMLButtonElement; choice: Choice; allowed: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!choice || !enabled) return;
    (
      cards.current?.querySelector<HTMLButtonElement>('button.auto:not(:disabled)') ??
      cards.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    )?.focus({ preventScroll: true });
  }, [choice, enabled]);

  useLayoutEffect(() => {
    input.show(choice, performance.now());
    press.current = click.current = null;
    if (!enabled) input.cancel(performance.now());
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      const delay = enabled ? input.remaining(performance.now()) : Infinity;
      setPointerReady(delay === 0);
      if (Number.isFinite(delay) && delay > 0) timer = window.setTimeout(refresh, delay + 1);
    };
    const down = (event: PointerEvent) => {
      if (!enabled || event.button !== 0) return;
      click.current = null;
      const allowed = input.down(event.pointerId, performance.now());
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('button.card')
          : null;
      if (event.isPrimary && choice && button && cards.current?.contains(button)) {
        press.current = { button, choice, pointer: event.pointerId };
        // Consume protected contacts instead of letting them fall through to combat.
        if (!allowed) event.preventDefault();
      }
      refresh();
    };
    const up = (event: PointerEvent) => {
      const allowed = input.up(event.pointerId, performance.now(), event.type === 'pointercancel');
      const p = press.current;
      if (p?.pointer === event.pointerId) {
        const target = document.elementFromPoint(event.clientX, event.clientY);
        click.current = {
          button: p.button,
          choice: p.choice,
          allowed: allowed && p.button.contains(target),
        };
        press.current = null;
      }
      refresh();
    };
    const cancel = () => {
      input.cancel(performance.now());
      press.current = click.current = null;
      refresh();
    };
    const hidden = () => {
      if (document.hidden) cancel();
      else refresh();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (['Space', 'Enter'].includes(event.code)) click.current = null;
    };
    window.addEventListener('pointerdown', down, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    refresh();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [choice, enabled, input]);

  function accept(event: MouseEvent<HTMLButtonElement>): boolean {
    const native = event.nativeEvent;
    const p = click.current;
    const pointer =
      event.detail > 0 ||
      (native instanceof PointerEvent && native.pointerType !== '') ||
      p?.button === event.currentTarget;
    click.current = null;
    if (
      !enabled ||
      !choice ||
      (pointer && (!p?.allowed || p.choice !== choice || p.button !== event.currentTarget))
    ) {
      event.preventDefault();
      return false;
    }
    return true;
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    if (!buttons.length) return;
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (idx + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus({ preventScroll: true });
  }

  return { cards, pointerReady, accept, navigate };
}
