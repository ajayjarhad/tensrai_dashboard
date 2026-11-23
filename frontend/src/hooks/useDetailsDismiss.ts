import { type RefObject, useEffect } from 'react';

// A native <details> menu that also closes on an outside press, on Escape, or once a link or menu
// item in it is chosen.
export function useDetailsDismiss(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const close = () => {
      details.open = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.open) return;
      close();
      details.querySelector('summary')?.focus();
    };
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element).closest('a, [role="menuitem"]')) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    details.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      details.removeEventListener('click', onClick);
    };
  }, [ref]);
}
