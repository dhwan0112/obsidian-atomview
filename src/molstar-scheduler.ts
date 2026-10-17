import { timersFor } from "./timers.ts";
import type { TimerHandle } from "./timers.ts";
const timers = timersFor();
/** Modern desktop/worker scheduler. Replaces Mol* legacy IE script-element fallback.
 * Uses cancellable macrotasks, so long Mol* tasks yield to rendering and worker messages.
 * No DOM injection, remote code or persistent message listeners.
 */
function immediate<A extends unknown[]>(
  callback: (...args: A) => void,
  ...args: A
) {
  return timers.setTimeout(() => callback(...args), 0);
}
export const Scheduler = {
  setImmediate: immediate,
  clearImmediate: (handle: TimerHandle) => timers.clearTimeout(handle),
  immediatePromise: (): Promise<void> =>
    new Promise((resolve) => immediate(resolve)),
  delay: <T>(timeout: number, value?: T): Promise<T | undefined> =>
    new Promise((resolve) => timers.setTimeout(() => resolve(value), timeout)),
};
