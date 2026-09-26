import { addMonths, format, parseISO, setDate, startOfMonth, subMonths } from 'date-fns';
import { todayKst } from './dates';
export function currentSettlementMonth(now = new Date()): Date {
  const today = parseISO(todayKst(now));
  const month = startOfMonth(today);
  return today.getDate() >= 26 ? addMonths(month, 1) : month;
}
export function getSettlementPeriod(viewDate: Date) {
  const month = startOfMonth(viewDate);
  const end = setDate(month, 25);
  const start = setDate(subMonths(month, 1), 26);
  return { start, end, startStr: format(start, 'yyyy-MM-dd'), endStr: format(end, 'yyyy-MM-dd') };
}
export function cleaningSettlementTotals(rows: { cleanerId: string | null; status: string }[]) {
  return {
    done: rows.filter(c => c.status === 'done').length,
    pending: rows.filter(c => c.cleanerId && c.status !== 'done').length,
    unassigned: rows.filter(c => !c.cleanerId).length,
  };
}
