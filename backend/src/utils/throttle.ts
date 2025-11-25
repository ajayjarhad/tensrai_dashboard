export type ThrottledEmitter<T> = (value: T) => void;

/**
 * Latest-value throttler. Ensures emits happen at most `hz` times per second.
 * If updates arrive faster, only the latest pending value is delivered.
 */
export const createLatestThrottle = <T>(
  hz: number | undefined,
  emit: (value: T) => void
): ThrottledEmitter<T> => {
  if (!hz || hz <= 0) {
    return emit;
  }

  const interval = 1000 / hz;
  let lastEmitted = 0;
  let scheduled = false;
  let pending: T | null = null;

  return (value: T) => {
    const now = Date.now();
    const delta = now - lastEmitted;

    if (delta >= interval) {
      lastEmitted = now;
      emit(value);
      return;
    }

    pending = value;
    if (scheduled) return;

    scheduled = true;
    const delay = interval - delta;

    setTimeout(() => {
      scheduled = false;
      if (pending !== null) {
        lastEmitted = Date.now();
        emit(pending);
        pending = null;
      }
    }, delay);
  };
};
