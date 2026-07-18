const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const compactNumberFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function fmtTime(epochMs: number): string {
  return timeFormatter.format(new Date(epochMs));
}

export function fmtCredits(value: number): string {
  return compactNumberFormatter.format(value);
}

export function fmtRelative(epochMs: number, nowMs = Date.now()): string {
  const seconds = Math.round((epochMs - nowMs) / 1_000);
  const absSeconds = Math.abs(seconds);

  if (absSeconds < 60) {
    return relativeFormatter.format(seconds, 'second');
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return relativeFormatter.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relativeFormatter.format(hours, 'hour');
  }
  return relativeFormatter.format(Math.round(hours / 24), 'day');
}
