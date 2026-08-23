interface StaleBannerProps {
  minutesSinceUpdate: number;
}

// Principle VII's stale rule: never show stale numbers as if they were live.
export function StaleBanner({ minutesSinceUpdate }: StaleBannerProps) {
  return <div role="status">Last updated {minutesSinceUpdate}m ago — reconnecting.</div>;
}
