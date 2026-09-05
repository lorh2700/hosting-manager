/**
 * 날짜 헬퍼 — 서버(Netlify, UTC)에서 "오늘"을 한국 시간 기준으로 계산할 때 사용.
 * DB 의 날짜 컬럼은 전부 YYYY-MM-DD 문자열이므로 문자열 비교로 정렬/범위 판단이 가능하다.
 */

const KST = 'Asia/Seoul';

/** 한국 시간 기준 오늘 (YYYY-MM-DD). */
export function todayKst(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: KST });
}

/** 한국 시간 기준 연/월 (month 는 1-12). */
export function kstYearMonth(now: Date = new Date()): { year: number; month: number } {
  const [y, m] = todayKst(now).split('-').map(Number);
  return { year: y, month: m };
}

/** YYYY-MM-DD 에 일수를 더한다 (UTC 기준 계산이라 타임존 영향 없음). */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD 에 개월 수를 더한다. 월말 넘침은 Date 규칙대로 다음 달로 넘어간다. */
export function addMonthsToDateStr(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** (year, month 1-12) 의 첫날 / 마지막날 YYYY-MM-DD. */
export function monthRange(year: number, month: number): { first: string; last: string } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  return { first: first.toISOString().slice(0, 10), last: last.toISOString().slice(0, 10) };
}
