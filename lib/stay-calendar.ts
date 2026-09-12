// Shared by the public calendar and server validation. Dates are property-local ISO days.
export type StayDay = { date: string; available: number; minStay: number; maxStay: number; arrival: boolean; departure: boolean };
export type StayCalendar = { days: Record<string, StayDay>; strategy: 'firstNight' | 'stayThrough' };
export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
export function arrivalIssue(calendar: StayCalendar | null, date: string): string | null {
  const day = calendar?.days[date];
  if (!day) return '예약 가능 여부를 확인 중입니다.';
  if (day.available < 1) return '판매 가능한 객실이 없습니다.';
  if (!day.arrival) return '체크인이 제한된 날짜입니다.';
  return null;
}
export function stayIssue(calendar: StayCalendar | null, arrival: string, departure: string): string | null {
  const nights = (Date.parse(departure) - Date.parse(arrival)) / 86400000;
  if (nights < 1 || nights > 30) return '1~30박 일정을 선택해주세요.';
  const issue = arrivalIssue(calendar, arrival);
  if (issue) return issue;
  const last = calendar?.days[departure];
  if (!last) return '체크아웃 가능 여부를 확인 중입니다.';
  if (!last.departure) return '체크아웃이 제한된 날짜입니다.';
  for (let date = arrival; date < departure; date = nextDay(date)) {
    const day = calendar?.days[date];
    if (!day) return '예약 가능 여부를 확인 중입니다.';
    if (day.available < 1) return '일정 중 판매 가능한 객실이 없는 날짜가 있습니다.';
    if (date === arrival || calendar?.strategy === 'stayThrough') {
      if (nights < day.minStay) return `선택한 일정은 최소 ${day.minStay}박부터 예약할 수 있습니다.`;
      if (nights > day.maxStay) return `선택한 일정은 최대 ${day.maxStay}박까지 예약할 수 있습니다.`;
    }
  }
  return null;
}
