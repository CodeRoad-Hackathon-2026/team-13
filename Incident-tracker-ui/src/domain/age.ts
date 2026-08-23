import type { Priority } from "../api/types";
import type { Clock } from "./clock";

// N3/FR-055: per-priority age thresholds — P1 30m / P2 2h / P3 8h / P4 24h.
const THRESHOLD_MINUTES: Record<Priority, number> = {
  P1: 30,
  P2: 120,
  P3: 480,
  P4: 1440,
};

export function ageMinutes(createdAt: string, clock: Clock): number {
  return Math.round((clock.now().getTime() - new Date(createdAt).getTime()) / 60_000);
}

export function isAgeFlagged(createdAt: string, priority: Priority, clock: Clock): boolean {
  return ageMinutes(createdAt, clock) > THRESHOLD_MINUTES[priority];
}

export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainderMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
