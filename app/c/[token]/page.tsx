import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, LogIn, Calendar } from 'lucide-react';
import CopyIcalButton from './CopyIcalButton';

export const dynamic = 'force-dynamic';

function parseMonthParam(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const d = parseISO(`${raw}-01`);
    if (!isNaN(d.getTime())) return d;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ m?: string }>;
}

export default async function CleanerPublicCalendar({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { m } = await searchParams;

  const cleaner = await prisma.cleaner.findUnique({
    where: { publicToken: token },
  });
  if (!cleaner) notFound();

  const monthDate = parseMonthParam(m);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const cleanings = await prisma.cleaning.findMany({
    where: {
      cleanerId: cleaner.id,
      date: {
        gte: format(gridStart, 'yyyy-MM-dd'),
        lte: format(gridEnd, 'yyyy-MM-dd'),
      },
    },
    include: { property: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  const byDate = new Map<string, typeof cleanings>();
  for (const c of cleanings) {
    const list = byDate.get(c.date) ?? [];
    list.push(c);
    byDate.set(c.date, list);
  }

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();
  const prevMonth = format(subMonths(monthStart, 1), 'yyyy-MM');
  const nextMonth = format(addMonths(monthStart, 1), 'yyyy-MM');

  const upcoming = cleanings
    .filter(c => c.date >= format(today, 'yyyy-MM-dd'))
    .slice(0, 10);

  return (
    <div className="min-h-dvh bg-[#050505] text-white font-sans">
      <header className="border-b border-white/10 px-5 sm:px-8 py-4 flex items-center justify-between">
        <span className="text-sm tracking-[0.2em] font-medium">void anchae</span>
        <Link
          href="/cleaner"
          className="flex items-center gap-2 text-[13px] uppercase tracking-widest text-white/60 hover:text-white transition-colors border border-white/10 hover:border-white/30 px-3 py-2"
        >
          <LogIn size={13} />
          로그인
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-8 sm:py-12">
        <div className="mb-8">
          <p className="text-[12px] tracking-[0.3em] text-white/50 mb-2">청소 일정</p>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight">{cleaner.name} 님</h1>
        </div>

        <div className="flex items-center justify-between mb-4">
          <Link
            href={`/c/${token}?m=${prevMonth}`}
            className="p-2 text-white/50 hover:text-white transition-colors"
            aria-label="이전 달"
          >
            <ChevronLeft size={18} />
          </Link>
          <h2 className="text-base sm:text-lg font-light tracking-wide">
            {format(monthStart, 'yyyy년 M월', { locale: ko })}
          </h2>
          <Link
            href={`/c/${token}?m=${nextMonth}`}
            className="p-2 text-white/50 hover:text-white transition-colors"
            aria-label="다음 달"
          >
            <ChevronRight size={18} />
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-px bg-white/5 border border-white/10">
          {['월', '화', '수', '목', '금', '토', '일'].map(d => (
            <div key={d} className="bg-[#050505] py-2 text-center text-[12px] uppercase tracking-widest text-white/40">
              {d}
            </div>
          ))}
          {days.map(day => {
            const key = format(day, 'yyyy-MM-dd');
            const items = byDate.get(key) ?? [];
            const inMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={key}
                className={`bg-[#050505] min-h-[72px] sm:min-h-[96px] p-1.5 sm:p-2 flex flex-col gap-1 ${
                  inMonth ? '' : 'opacity-30'
                }`}
              >
                <div
                  className={`text-[13px] sm:text-xs ${
                    isToday ? 'text-white font-semibold' : 'text-white/60'
                  } ${isToday ? 'w-5 h-5 rounded-full bg-white text-black flex items-center justify-center' : ''}`}
                >
                  {format(day, 'd')}
                </div>
                {items.map(item => (
                  <div
                    key={item.id}
                    className={`text-[12px] sm:text-[13px] leading-tight px-1.5 py-1 border-l-2 truncate ${
                      item.status === 'done'
                        ? 'bg-emerald-500/10 border-emerald-400/60 text-emerald-200/80'
                        : 'bg-white/5 border-white/40 text-white/80'
                    }`}
                    title={item.property?.name ?? ''}
                  >
                    {item.property?.name ?? '숙소'}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <CopyIcalButton token={token} />
          <span className="text-[13px] text-white/40">
            캘린더 앱에서 자동 동기화되며, 배정 변경 시 자동 반영됩니다.
          </span>
        </div>

        <section className="mt-12">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={14} className="text-white/40" />
            <h3 className="text-sm tracking-widest font-medium">다가오는 일정</h3>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-white/40 py-6">예정된 청소 일정이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map(item => {
                const d = parseISO(item.date);
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between border border-white/10 px-4 py-3 hover:border-white/30 transition-colors"
                  >
                    <div>
                      <p className="text-sm">{item.property?.name ?? '숙소'}</p>
                      <p className="text-[13px] text-white/50 mt-0.5">
                        {format(d, 'M월 d일 (EEE)', { locale: ko })}
                      </p>
                    </div>
                    <span
                      className={`text-[12px] uppercase tracking-widest px-2 py-1 ${
                        item.status === 'done'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-white/5 text-white/60'
                      }`}
                    >
                      {item.status === 'done' ? '완료' : '예정'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="mt-12 text-[13px] text-white/30 leading-relaxed">
          수정·완료 처리·이슈 신고 등은 상단 <span className="text-white/60">로그인</span> 버튼을 눌러 진행해 주세요.
        </p>
      </main>
    </div>
  );
}
