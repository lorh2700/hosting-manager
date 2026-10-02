import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/core/errors';
import {
  JongnoValidationError, parseJongnoEventInput, parseJongnoEventQuery, parseJongnoVersion,
  type JongnoEventDTO, type JongnoEventInput, type JongnoEventPage, type JongnoEventQuery,
} from '@/lib/jongno-events';
import type { JongnoEvent, Prisma } from '@/generated/prisma/client';

function validated<T>(fn: () => T): T {
  try { return fn(); } catch (error) {
    if (error instanceof JongnoValidationError) throw fail(400, error.message);
    throw error;
  }
}
export const readJongnoEventInput = (raw: unknown) => validated(() => parseJongnoEventInput(raw));
export const readJongnoEventVersion = (raw: unknown) => validated(() => parseJongnoVersion(raw));
export const readJongnoEventQuery = (req: Request, publicOnly: boolean) => validated(() => parseJongnoEventQuery(new URL(req.url).searchParams, publicOnly));

export function jongnoEventDTO(row: JongnoEvent): JongnoEventDTO {
  return {
    id: row.id, titleKo: row.titleKo, titleEn: row.titleEn, descriptionKo: row.descriptionKo, descriptionEn: row.descriptionEn,
    category: row.category as JongnoEventDTO['category'], area: row.area as JongnoEventDTO['area'],
    venue: row.venue, address: row.address, startDate: row.startDate, endDate: row.endDate, timeText: row.timeText,
    excludedWeekdays: row.excludedWeekdays as number[], excludedDates: row.excludedDates as string[],
    feeType: row.feeType as JongnoEventDTO['feeType'], feeText: row.feeText, bookingRequired: row.bookingRequired,
    officialUrl: row.officialUrl, bookingUrl: row.bookingUrl, mapUrl: row.mapUrl, languageText: row.languageText,
    images: row.images as unknown as JongnoEventDTO['images'], status: row.status as JongnoEventDTO['status'],
    verifiedAt: row.verifiedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(), version: row.version,
  };
}
function storeError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2021') {
    throw fail(503, '종로 행사 저장소 준비가 필요합니다. 관리자에게 알려주세요.');
  }
  throw error;
}
export async function listJongnoEvents(query: JongnoEventQuery, publicOnly: boolean): Promise<JongnoEventPage> {
  try {
    const where: Prisma.JongnoEventWhereInput = {
      ...(publicOnly ? { status: 'published' } : query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}), ...(query.area ? { area: query.area } : {}),
      ...(query.range ? { startDate: { lte: query.range.to }, endDate: { gte: query.range.from } } : {}),
    };
    const rows = await prisma.jongnoEvent.findMany({
      where, orderBy: [{ startDate: 'asc' }, { id: 'asc' }], take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const visible = rows.slice(0, query.limit);
    return { events: visible.map(jongnoEventDTO), hasMore, nextCursor: hasMore ? visible[visible.length - 1].id : null, range: query.range };
  } catch (error) { return storeError(error); }
}
function dataFor(input: JongnoEventInput) {
  return { ...input, images: input.images as unknown as Prisma.InputJsonValue, excludedWeekdays: input.excludedWeekdays as Prisma.InputJsonValue,
    excludedDates: input.excludedDates as Prisma.InputJsonValue, verifiedAt: input.verifiedAt ? new Date(input.verifiedAt) : null };
}
export async function createJongnoEvent(input: JongnoEventInput, userId: string): Promise<JongnoEventDTO> {
  try {
    return jongnoEventDTO(await prisma.jongnoEvent.create({ data: { ...dataFor(input), createdBy: userId } }));
  } catch (error) { return storeError(error); }
}
export async function getJongnoEvent(id: string): Promise<JongnoEventDTO> {
  try {
    const row = await prisma.jongnoEvent.findUnique({ where: { id } });
    if (!row) throw fail(404, '행사를 찾을 수 없습니다.');
    return jongnoEventDTO(row);
  } catch (error) { return storeError(error); }
}
export async function updateJongnoEvent(id: string, input: JongnoEventInput, version: number): Promise<JongnoEventDTO> {
  try {
    // The conditional UPDATE locks the row; reading inside the same transaction
    // returns precisely this version, even when another editor saves at once.
    return await prisma.$transaction(async tx => {
      const changed = await tx.jongnoEvent.updateMany({ where: { id, version }, data: { ...dataFor(input), version: { increment: 1 } } });
      if (changed.count === 0) {
        if (!await tx.jongnoEvent.findUnique({ where: { id }, select: { id: true } })) throw fail(404, '행사를 찾을 수 없습니다.');
        throw fail(409, '다른 관리자가 내용을 수정했습니다. 최신 내용을 다시 불러와주세요.');
      }
      const row = await tx.jongnoEvent.findUnique({ where: { id } });
      if (!row) throw fail(404, '행사를 찾을 수 없습니다.');
      return jongnoEventDTO(row);
    });
  } catch (error) { return storeError(error); }
}
