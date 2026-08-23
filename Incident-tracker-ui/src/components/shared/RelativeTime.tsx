import type { Clock } from "../../domain/clock";
import { systemClock } from "../../domain/clock";

interface RelativeTimeProps {
  timestamp: string;
  clock?: Clock;
}

function formatRelative(diffMs: number): string {
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainderMinutes}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// X-5: relative by default, absolute + timezone on hover (the title attribute).
export function RelativeTime({ timestamp, clock = systemClock }: RelativeTimeProps) {
  const date = new Date(timestamp);
  const diffMs = clock.now().getTime() - date.getTime();
  // Intl doesn't allow combining timeZoneName with the dateStyle/timeStyle shorthand,
  // so the individual components are spelled out instead.
  const absolute = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <time dateTime={timestamp} title={absolute}>
      {formatRelative(diffMs)}
    </time>
  );
}
