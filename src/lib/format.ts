/** Display formatting helpers. All dates are formatted in UTC for consistency. */

const DATE_SHORT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const DATE_LONG = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return DATE_SHORT.format(date);
}

export function formatDateLong(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return DATE_LONG.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return `${DATE_TIME.format(date)} UTC`;
}

/** Machine-readable value for <time dateTime>. */
export function isoAttribute(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function formatPercent(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

export function formatSignedPoints(value: number, digits = 1): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

/** Whole days between two instants, ignoring time-of-day drift. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/** "in 23 days" / "today" / "412 days ago" — used on horizon displays. */
export function relativeDays(iso: string, now: Date = new Date()): string {
  const days = daysBetween(now.toISOString(), iso);
  if (days === 0) return 'today';
  if (days > 0) return `in ${formatInteger(days)} day${days === 1 ? '' : 's'}`;
  const past = Math.abs(days);
  return `${formatInteger(past)} day${past === 1 ? '' : 's'} ago`;
}

