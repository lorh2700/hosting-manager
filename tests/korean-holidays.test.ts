import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKoreanHolidays } from '../lib/korean-holidays.ts';
test('holiday calendar excludes observances and cancelled events, unfolds names',()=>{
 const events=[['20261003','개천절','공휴일','CONFIRMED'],['20261005','쉬는 날 개천\r\n 절','공휴일','CONFIRMED'],['20261001','국군의날','기념일','CONFIRMED'],['20261002','취소','공휴일','CANCELLED']].map(([d,n,t,s])=>`BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${d}\r\nSUMMARY:${n}\r\nDESCRIPTION:${t}\r\nSTATUS:${s}\r\nEND:VEVENT`).join('\r\n');
 assert.deepEqual(parseKoreanHolidays('BEGIN:VCALENDAR\r\n'+events),{'2026-10-03':'개천절','2026-10-05':'대체공휴일 · 개천절'});
});
test('invalid or empty calendars must not silently mean no holidays',()=>{assert.throws(()=>parseKoreanHolidays('bad'));assert.throws(()=>parseKoreanHolidays('BEGIN:VCALENDAR'));});
