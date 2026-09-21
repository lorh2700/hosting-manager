import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyStayLayout } from '../lib/weekly-stay-layout';
const stay = (id: string, start: string, end: string, type: 'reservation' | 'block' = 'reservation') => ({id,start,end,type});
test('same-day turnover shares a row and meets at midday', () => {
 const bars=weeklyStayLayout([stay('a','2026-09-19','2026-09-23'),stay('b','2026-09-23','2026-09-25')],'2026-09-21');
 assert.equal(bars[0].row,0); assert.equal(bars[1].row,0);
 assert.equal(bars[0].left+bars[0].width,bars[1].left);
 assert.equal(bars[0].continuesBefore,true);
});
test('overlapping reservations remain individually visible', () => {
 const bars=weeklyStayLayout([stay('a','2026-09-21','2026-09-25'),stay('b','2026-09-22','2026-09-24')],'2026-09-21');
 assert.deepEqual(bars.map(b=>b.row),[0,1]);
});
test('week clipping crosses year boundaries and excludes expired blocks', () => {
 const bars=weeklyStayLayout([stay('a','2026-12-20','2027-01-10'),stay('b','2026-12-27','2026-12-28','block')],'2026-12-28');
 assert.equal(bars.length,1); assert.equal(bars[0].width,100); assert.ok(bars[0].continuesBefore&&bars[0].continuesAfter);
});
test('checkout on Monday remains a half-day and blocks use whole days', () => {
 const bars=weeklyStayLayout([stay('a','2026-09-20','2026-09-21'),stay('b','2026-09-22','2026-09-23','block')],'2026-09-21');
 assert.equal(bars[0].width,0.5/7*100); assert.equal(bars[1].width,1/7*100);
});
