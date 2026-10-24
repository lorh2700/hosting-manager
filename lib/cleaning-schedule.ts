type CleaningSchedule = {
  propertyId: string;
  date: string;
  origin?: string;
  cleanerId?: string | null;
  assistantCleanerId?: string | null;
  externalCleanerName?: string | null;
  status: string;
};

export function availableCheckoutCleanings<T extends CleaningSchedule>(rows: T[], from: string, to: string, role: 'primary' | 'assistant' = 'primary', userId?: string): T[] {
  const checkoutRows = rows.filter(row => row.origin !== 'interim' && row.status !== 'cancelled');
  const counts = new Map<string, number>();
  for (const row of checkoutRows) { const key = JSON.stringify([row.propertyId, row.date]); counts.set(key, (counts.get(key) || 0) + 1); }
  return checkoutRows.filter(row => row.status !== 'done' && row.date >= from && row.date <= to
    && counts.get(JSON.stringify([row.propertyId, row.date])) === 1
    && (role === 'assistant' ? !row.assistantCleanerId : !row.cleanerId && !row.externalCleanerName?.trim())
    && (!userId || (row.cleanerId !== userId && row.assistantCleanerId !== userId)));
}
