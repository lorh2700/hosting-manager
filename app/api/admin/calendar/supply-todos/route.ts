import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAuth, query } from '@/lib/core/http';
import { calendarMonthRange } from '@/lib/calendar-month';

// 캘린더 비품 패널 — 메인 캘린더 응답과 분리해 지연 로딩한다.
export const GET = withAuth('admin/calendar/supply-todos', async (req, { auth }) => {
  const { first, last } = calendarMonthRange(query(req, 'month'));
  const properties = await prisma.property.findMany({
    where: auth.isAdmin ? {} : { id: { in: auth.propertyIds ?? [] } },
    select: { id: true },
  });
  const propertyIds = properties.map(p => p.id);
  if (propertyIds.length === 0) return NextResponse.json({ supplyTodos: [] });

  const supplyTodos = await prisma.supplyTodo.findMany({
    where: { propertyId: { in: propertyIds }, date: { gte: first, lte: last } },
    select: { id: true, propertyId: true, date: true, text: true, done: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(
    { supplyTodos },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});
