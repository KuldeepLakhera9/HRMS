/**
 * Date and time utilities:
 * AGENTS.md rule: "Timestamps: timestamptz in UTC. Store UTC; attendance also stores local business date + timezone."
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

export function toUTC(dateInput?: Date | string | number): Date {
  const d = dateInput === undefined ? new Date() : new Date(dateInput);
  if (isNaN(d.getTime())) {
    throw new TypeError(`Invalid date input: ${String(dateInput)}`);
  }
  return d;
}

export function toISOUtc(dateInput?: Date | string | number): string {
  return toUTC(dateInput).toISOString();
}

/**
 * Returns date in YYYY-MM-DD format according to the given timezone (defaults to Asia/Kolkata).
 */
export function getBusinessDateString(
  dateInput?: Date | string | number,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const d = toUTC(dateInput);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}
