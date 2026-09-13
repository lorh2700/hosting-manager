export function parseKoreanHolidays(ics: string) {
  if (!ics.includes('BEGIN:VCALENDAR')) throw new Error('Invalid holiday calendar');
  const holidays: Record<string,string> = {};
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  for (const event of unfolded.split('BEGIN:VEVENT').slice(1)) {
    if (!/^DESCRIPTION:공휴일(?:\r?\n|$)/m.test(event) || /^STATUS:CANCELLED/m.test(event)) continue;
    const day = event.match(/^DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/m);
    const title = event.match(/^SUMMARY:(.+)/m)?.[1].trim();
    if (day && title) holidays[`${day[1]}-${day[2]}-${day[3]}`] = title.replace(/^쉬는 날 /,'대체공휴일 · ');
  }
  if (!Object.keys(holidays).length) throw new Error('Empty holiday calendar');
  return holidays;
}
