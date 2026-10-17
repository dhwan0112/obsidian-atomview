/** A view keeps the same timer owner for scheduling and cancellation.
 * Window-backed views use that window's timers; workers and standalone reader tests
 * use native timers without requiring a DOM or adding a persistent message listener.
 */
export type TimerHandle = number | ReturnType<typeof setTimeout>;
export interface TimerHost {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle?: TimerHandle): void;
  setInterval(callback: () => void, ms: number): TimerHandle;
  clearInterval(handle?: TimerHandle): void;
}
const nativeTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
export function timersFor(owner?: Window | null): TimerHost {
  const win = owner ?? (typeof window !== "undefined" ? window : undefined);
  if (!win) return nativeTimers;
  return {
    setTimeout: (callback, ms) => win.setTimeout(callback, ms),
    clearTimeout: (handle) => win.clearTimeout(handle as number | undefined),
    setInterval: (callback, ms) => win.setInterval(callback, ms),
    clearInterval: (handle) => win.clearInterval(handle as number | undefined),
  };
}
