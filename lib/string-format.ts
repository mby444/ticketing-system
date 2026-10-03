/**
 * Formats a date as a relative time string ("2h ago", "3d ago").
 *
 * `now` is a parameter rather than read from the clock so the unit boundaries
 * are testable — a helper that reads the clock inside itself can only be tested
 * by tolerating a slow run sliding a value across an edge.
 *
 * Every unit rounds DOWN. Rounding up would claim more time has elapsed than
 * actually has, which is the kind of small lie that makes a timestamp feel
 * wrong to the person reading it.
 */
export function formatRelativeTime(
  date: Date | string,
  now: Date = new Date(),
): string {
  const value = date instanceof Date ? date : new Date(date);
  const diffMs = now.getTime() - value.getTime();

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}