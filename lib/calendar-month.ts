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
