import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function dateOnly(yyyyMmDd: string): string {
  return yyyyMmDd.replace(/-/g, '');
}

function nextDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const y2 = dt.getUTCFullYear();
  const m2 = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d2 = String(dt.getUTCDate()).padStart(2, '0');
  return `${y2}${m2}${d2}`;
}

function nowStampUtc(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { token } = await params;

  const cleaner = await prisma.cleaner.findUnique({ where: { publicToken: token } });
  if (!cleaner) {
    return new Response('Not Found', { status: 404 });
  }

  const cleanings = await prisma.cleaning.findMany({
    where: { cleanerId: cleaner.id },
    include: { property: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  const stamp = nowStampUtc();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//void anchae//Cleaner Schedule//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(`청소 일정 - ${cleaner.name}`)}`,
    'X-WR-TIMEZONE:Asia/Seoul',
  ];

  for (const c of cleanings) {
    const propName = c.property?.name ?? '숙소';
    const statusLabel = c.status === 'done' ? '완료' : '예정';
    const notes = c.notes ? `\n메모: ${c.notes}` : '';
    const supplies = c.supplies ? `\n준비물: ${c.supplies}` : '';

    lines.push(
      'BEGIN:VEVENT',
      `UID:cleaning-${c.id}@voidanchae`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateOnly(c.date)}`,
      `DTEND;VALUE=DATE:${nextDay(c.date)}`,
      `SUMMARY:${escapeIcs(`[청소] ${propName}`)}`,
      `DESCRIPTION:${escapeIcs(`상태: ${statusLabel}${supplies}${notes}`)}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  const body = lines.join('\r\n') + '\r\n';

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': `inline; filename="cleaner-${cleaner.id}.ics"`,
    },
  });
}
