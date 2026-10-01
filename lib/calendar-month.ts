import { kstYearMonth, monthRange } from './dates';
import { fail } from './core/errors';

/** One calendar month, defaulting to the current month in Korea. */
export function calendarMonthRange(value?: string | null) {
  if (value == null) {
    const { year, month } = kstYearMonth();
    return monthRange(year, month);
  }
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) {
    throw fail(400, '조회 월은 YYYY-MM 형식이어야 합니다.');
  }
  const [year, month] = value.split('-').map(Number);
  return monthRange(year, month);
}

/** Covers the Sunday–Saturday month grid and each Monday–Sunday mobile week. */
export function calendarGridRange(value?: string | null) {
  const { first, last } = calendarMonthRange(value);
  const start = new Date(first + 'T00:00:00Z');
  const end = new Date(last + 'T00:00:00Z');
  // A month beginning on Sunday also displays the preceding Monday–Saturday
  // in mobile weekly mode. At the other end, weekly mode includes Sunday.
  start.setUTCDate(start.getUTCDate() - Math.max(start.getUTCDay(), (start.getUTCDay() + 6) % 7));
  end.setUTCDate(end.getUTCDate() + Math.max(6 - end.getUTCDay(), (7 - end.getUTCDay()) % 7));
  return { first: start.toISOString().slice(0,10), last: end.toISOString().slice(0,10) };
}
