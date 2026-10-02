export type LaundryViewRow = {
  status: string;
  pickupDate: string;
  deliveryDate: string;
  history?: unknown;
};

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function ongoing(row: LaundryViewRow) {
  return row.status !== 'completed' && row.status !== 'cancelled';
}

/** An unknown deadline is never classified as late. */
export function isLaundryOverdue(row: LaundryViewRow, today: string): boolean {
  return ongoing(row) && validDate(today) && validDate(row.deliveryDate) && row.deliveryDate < today;
}

/** Scheduled pickups use their pickup date; collected batches use a confirmed delivery deadline. */
export function isLaundryDue(row: LaundryViewRow, today: string): boolean {
  const date = row.status === 'scheduled' ? row.pickupDate : row.deliveryDate;
  return ongoing(row) && validDate(today) && validDate(date) && date <= today;
}

export function isLaundryRecordedToday(row: LaundryViewRow, today: string): boolean {
  if (!validDate(today)) return false;
  return validDate(row.pickupDate) && row.pickupDate === today
    || validDate(row.deliveryDate) && row.deliveryDate === today;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Quick-send pickupDate initially records submission day, until a later schedule confirms an actual pickup. */
export function laundryPickupDateLabel(row: LaundryViewRow): '기록일' | '수거' {
  const history = Array.isArray(row.history) ? row.history : [];
  const first = record(history[0]);
  const request = record(first?.request);
  if (request?.quickSend !== true) return '수거';
  const confirmedPickup = history.slice(1).some(entry => {
    const change = record(entry);
    return change?.action === 'schedule' && validDate(record(change.schedule)?.pickupDate);
  });
  return confirmedPickup ? '수거' : '기록일';
}
