import type { Clock } from "./clock";
import { systemClock } from "./clock";

export const FAST_POLL_MS = 2000;
export const SLOW_POLL_MS = 15_000;
export const STILL_RUNNING_BOUND_MS = 2 * 60 * 1000;

export function elapsedExecutionMs(startedAt: string, clock: Clock = systemClock): number {
  return clock.now().getTime() - new Date(startedAt).getTime();
}

// FR-041: at and after 2 minutes the card switches to "still running" — never inferred from a
// failed/missing poll, only from elapsed wall-clock time against the injected clock.
export function isStillRunning(startedAt: string, clock: Clock = systemClock): boolean {
  return elapsedExecutionMs(startedAt, clock) >= STILL_RUNNING_BOUND_MS;
}

export function pollIntervalMs(startedAt: string, clock: Clock = systemClock): number {
  return isStillRunning(startedAt, clock) ? SLOW_POLL_MS : FAST_POLL_MS;
}

export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
