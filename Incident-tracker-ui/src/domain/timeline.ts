// TL-3: cumulative elapsed time since INCIDENT_CREATED, shown on each timeline event. A pure
// timestamp difference — no clock needed, since both endpoints are historical, stored values.
export function cumulativeElapsed(eventAt: string, incidentCreatedAt: string): string {
  const diffMs = new Date(eventAt).getTime() - new Date(incidentCreatedAt).getTime();
  const totalSeconds = Math.max(0, Math.round(diffMs / 1000));

  if (totalSeconds < 60) return `+${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `+${minutes}m ${seconds}s` : `+${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return `+${hours}h ${remainderMinutes}m`;
}
