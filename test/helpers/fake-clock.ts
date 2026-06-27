/** A manually-driven repeating timer for testing the scheduler's look-ahead. */
import type { SchedulerClock } from "../../src/scheduler";

export class FakeClock implements SchedulerClock {
  callback: (() => void) | null = null;
  intervalMs: number | null = null;
  startCount = 0;
  stopCount = 0;

  start(callback: () => void, intervalMs: number): void {
    this.callback = callback;
    this.intervalMs = intervalMs;
    this.startCount++;
  }

  stop(): void {
    // Deliberately keep the callback so a test can simulate a stray timer fire
    // after stop() — this exercises the scheduler's own `running` guard, not just
    // the clock having been cleared.
    this.stopCount++;
  }

  /** Fire the registered callback once (a simulated timer tick). */
  tick(): void {
    this.callback?.();
  }
}
