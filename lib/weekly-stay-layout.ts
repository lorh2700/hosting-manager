type Stay = { id: string; start: string; end: string; type: 'reservation' | 'block' };
const dayNumber = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export function weeklyStayLayout<T extends Stay>(events: T[], weekStart: string) {
  const origin = dayNumber(weekStart);
  const rowEnds: number[] = [];
  return events.map(event => {
    const half = event.type === 'reservation' ? 0.5 : 0;
    const start = dayNumber(event.start) - origin + half;
    const end = dayNumber(event.end) - origin + half;
    return { event, start, end };
  }).filter(e => e.end > 0 && e.start < 7 && e.end > e.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.event.id.localeCompare(b.event.id))
    .map(e => {
      const start = Math.max(0, e.start), end = Math.min(7, e.end);
      let row = rowEnds.findIndex(last => last <= start);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = end;
      return { event: e.event, row, left: start / 7 * 100, width: (end - start) / 7 * 100,
        continuesBefore: e.start < 0, continuesAfter: e.end > 7 };
    });
}
