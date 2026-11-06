import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function Dialog({
  titleId,
  className,
  modalClassName = '',
  focusKey,
  children,
}: {
  titleId: string;
  className: string;
  modalClassName?: string;
  focusKey?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    (
      dialog.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
      dialog.querySelector<HTMLElement>('button.primary:not(:disabled)') ??
      dialog.querySelector<HTMLElement>('button:not(:disabled), summary')
    )?.focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), summary')];
      const first = buttons[0],
        last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [focusKey]);

  return (
    <div className={`modal ${modalClassName}`}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog ${className}`}
      >
        {children}
      </section>
    </div>
  );
}
