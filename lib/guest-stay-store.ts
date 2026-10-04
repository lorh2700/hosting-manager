import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/core/errors';
import { getPropertyDisplay, slugCandidates } from '@/lib/property-display';
import { guestGuide } from '@/lib/guest-guide';
import { openInvitation } from '@/lib/guest-invitation-token';
import { recoverInvitation } from '@/lib/guest-invitation-recovery';
import { todayKst } from '@/lib/dates';
import { propertyAllowsModule } from '@/lib/operational-access';
import { requirePropertyModule } from '@/lib/operational-feature-store';
import { guestStayBounds, guestStayPhase, guestStayRequestSchema, normalizeGuestStayName, requestDateWithinStay,
  type GuestStayPropertyDTO, type GuestStayDTO, type GuestStayRequestDTO, type GuestStayRequestInput } from '@/lib/guest-stay';

export const GUEST_STAY_COOKIE = 'va_guest_stay';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const propertySelect = { id: true, slug: true, name: true, status: true, welcomepadKey: true,
  featureOverrides: true, organization: { select: { status: true, features: true } } } as const;
export type StayReference = { kind: 'event' | 'booking'; id: string; propertyId: string };
export type LiveGuestStay = StayReference & { guestName: string; checkIn: string; checkOut: string; guests: number | null;
  property: GuestStayPropertyDTO; phase: 'before_arrival' | 'staying'; expiresAt: Date; fingerprint: string };
export const guestStayHash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => {
  if (!process.env.JWT_SECRET) throw fail(503, '게스트 서비스를 준비 중입니다.');
  return process.env.JWT_SECRET;
};
export function normalizeStayCode(code: string) { return code.toUpperCase().replace(/[\s-]/g, ''); }
export function newStayCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('').match(/.{4}/g)!.join('-');
}
export const newStayToken = () => randomBytes(32).toString('base64url');
export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function guestStayCsrf(token: string) {
  return createHmac('sha256', secret()).update(`guest-stay-csrf:${token}`).digest('base64url');
}
export function requireStayOrigin(req: Request) {
  const origin = req.headers.get('origin');
  // Every browser write, including login, must come from this app. Missing Origin is
  // allowed only for a paired pad's bearer-authenticated server-to-server bridge.
  if (!origin || origin !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site') {
    throw fail(403, '이 화면에서 다시 시도해 주세요.', { code: 'invalid_origin' });
  }
}
export function requireStayCsrf(req: Request, token: string, body: Record<string, unknown>) {
  requireStayOrigin(req);
  const provided = typeof body.csrfToken === 'string' ? body.csrfToken : req.headers.get('x-guest-csrf') || '';
  if (!safeEqual(provided, guestStayCsrf(token))) throw fail(403, '화면을 새로고침한 후 다시 시도해 주세요.', { code: 'invalid_csrf' });
}
export function privateStayResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff' } });
}
export function setGuestStayCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(GUEST_STAY_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', expires: expiresAt });
}
export function clearGuestStayCookie(response: NextResponse) {
  response.cookies.set(GUEST_STAY_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
}
export async function readStayJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length') || 0) > 16384) throw fail(413, '신청 내용이 너무 깁니다.');
  const reader = req.body?.getReader();
  if (!reader) throw fail(400, '신청 내용을 확인해 주세요.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw fail(413, '신청 내용이 너무 깁니다.'); }
      chunks.push(result.value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, '신청 내용을 확인해 주세요.');
    return body;
  } catch (error) {
    if (error instanceof SyntaxError) throw fail(400, '신청 내용을 확인해 주세요.');
    throw error;
  } finally { reader.releaseLock(); }
}

export async function stayProperty(slug: string): Promise<GuestStayPropertyDTO | null> {
  const display = getPropertyDisplay(slug);
  if (!display) return null;
  const property = await prisma.property.findFirst({ where: { slug: { in: slugCandidates(slug) }, status: 'active' }, select: propertySelect });
  if (!property || !propertyAllowsModule(property, 'guestServices')) return null;
  const guide = guestGuide(display.slug);
  return { id: property.id, slug: display.slug, name: display.name || property.name,
    nameEn: guide?.nameEn || (display.slug === 'dowonjae' ? 'Dowonjae' : display.name),
    image: display.imageFiles[0] ? `/images/${display.imageFolder}/${display.imageFiles[0]}.webp` : '',
    address: guide?.address || display.addressKo, addressEn: guide?.addressEn || display.addressKo,
    checkInTime: display.checkInTime, checkOutTime: display.checkOutTime, region: display.region };
}

export function stayFingerprint(stay: StayReference & { guestName: string; checkIn: string; checkOut: string }) {
  return guestStayHash(JSON.stringify([stay.kind, stay.id, stay.propertyId, normalizeGuestStayName(stay.guestName), stay.checkIn, stay.checkOut]));
}
export async function liveStay(reference: StayReference, now = Date.now()): Promise<LiveGuestStay | null> {
  let raw: { propertyId: string; guestName: string; checkIn: string; checkOut: string; guests: number | null; slug: string | null } | null = null;
  if (reference.kind === 'booking') {
    const b = await prisma.booking.findUnique({ where: { id: reference.id }, select: { propertyId: true, name: true, status: true,
      checkIn: true, checkOut: true, guests: true, property: { select: propertySelect } } });
    if (b?.status === 'confirmed' && b.property.status === 'active' && b.name?.trim()) {
      raw = { propertyId: b.propertyId, guestName: b.name.trim(), checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests, slug: b.property.slug };
    }
  } else {
    const e = await prisma.event.findUnique({ where: { id: reference.id }, select: { propertyId: true, title: true, type: true, source: true,
      channelId: true, startDate: true, endDate: true, numAdults: true, numChildren: true, property: { select: propertySelect } } });
    const name = e?.title?.replace(/\s+예약$/, '').trim();
    if (e?.type === 'reservation' && e.source !== 'maintenance' && ['beds24', 'direct'].includes(e.channelId || '') &&
      e.property.status === 'active' && name && !name.startsWith('[문의]')) {
      raw = { propertyId: e.propertyId, guestName: name, checkIn: e.startDate, checkOut: e.endDate,
        guests: e.numAdults === null ? null : e.numAdults + (e.numChildren || 0), slug: e.property.slug };
    }
  }
  if (!raw || raw.propertyId !== reference.propertyId || !raw.slug) return null;
  const property = await stayProperty(raw.slug);
  if (!property || property.id !== reference.propertyId) return null;
  const bounds = guestStayBounds(raw.checkIn, raw.checkOut, property.checkInTime, property.checkOutTime);
  const phase = guestStayPhase(raw.checkIn, raw.checkOut, now, property.checkInTime, property.checkOutTime);
  if (!bounds || !phase) return null;
  return { ...reference, ...raw, property, phase, expiresAt: new Date(bounds.end), fingerprint: stayFingerprint({ ...reference, ...raw }) };
}

/** Atomic shared-DB buckets survive serverless restarts and simultaneous attempts. No raw names/IPs are stored. */
export async function throttleStayAttempt(req: Request, scope: string, limit = 30, minutes = 10) {
  const now = Date.now(), bucket = Math.floor(now / (minutes * 60000));
  const ip = (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim();
  const expiresAt = new Date((bucket + 1) * minutes * 60000);
  const keyHash = guestStayHash(`${scope}:${ip}:${bucket}`);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO guest_stay_attempts (key_hash,count,expires_at) VALUES (${keyHash},1,${expiresAt})
    ON CONFLICT (key_hash) DO UPDATE SET count=guest_stay_attempts.count+1 RETURNING count
  `;
  if (!rows[0] || rows[0].count > limit) throw fail(429, '잠시 후 다시 시도해 주세요.', { code: 'rate_limited', retryAfter: Math.ceil((expiresAt.getTime() - now) / 1000) });
  // Bound expired rows without putting cleanup on every successful request.
  if (rows[0].count === 1) await prisma.$executeRaw`DELETE FROM guest_stay_attempts WHERE key_hash IN (
    SELECT key_hash FROM guest_stay_attempts WHERE expires_at < ${new Date(now - 86400000)} LIMIT 100
  )`;
}

export async function requireGuestStay(req: Request) {
  const match = (req.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${GUEST_STAY_COOKIE}=`));
  const token = match?.slice(GUEST_STAY_COOKIE.length + 1) || '';
  if (!TOKEN_RE.test(token)) throw fail(401, '예약 정보를 확인하고 다시 로그인해 주세요.', { code: 'guest_session_required' });
  const expected = req.headers.get('x-guest-csrf');
  if (expected && !safeEqual(expected, guestStayCsrf(token))) throw fail(401, '다른 예약으로 로그인되었습니다. 다시 확인해 주세요.', { code: 'guest_session_changed' });
  const session = await prisma.guestStaySession.findUnique({ where: { tokenHash: guestStayHash(token) }, include: { access: true } });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now || session.access.revokedAt || session.access.expiresAt.getTime() <= now) {
    throw fail(401, '이용 기간이 끝났거나 접근이 해제되었습니다.', { code: 'guest_session_expired' });
  }
  if (session.access.deviceId) {
    const device = await prisma.guestStayDevice.findUnique({ where: { id: session.access.deviceId }, select: { revokedAt: true, expiresAt: true } });
    if (!device || device.revokedAt || device.expiresAt.getTime() <= now) throw fail(401, '접근이 해제되었습니다.', { code: 'guest_session_expired' });
  }
  const stay = await liveStay({ kind: session.access.reservationKind as StayReference['kind'], id: session.access.reservationId,
    propertyId: session.access.propertyId }, now);
  if (!stay || !safeEqual(stay.fingerprint, session.access.fingerprint)) throw fail(401, '예약 정보가 변경되었습니다. 다시 확인해 주세요.', { code: 'guest_session_expired' });
  const slug = new URL(req.url).searchParams.get('slug');
  if (slug && slug !== stay.property.slug) throw fail(403, '다른 숙소의 예약입니다.');
  return { token, session, stay };
}

export async function loginGuestStay(req: Request, input: { slug: string; name: string; code?: string; invitation?: string; accessToken?: string }) {
  const invalid = () => fail(401, '예약자 이름과 이용 정보를 다시 확인해 주세요.', { code: 'invalid_credentials' });
  await throttleStayAttempt(req, 'login', 30);
  // Credential-level bucket also holds if a caller changes its claimed IP address.
  const proof = input.code ? normalizeStayCode(input.code) : input.invitation || input.accessToken || '';
  const keyHash = guestStayHash(`credential:${input.slug}:${guestStayHash(proof)}:${Math.floor(Date.now() / 600000)}`);
  const attempts = await prisma.guestStayAttempt.upsert({ where: { keyHash }, create: { keyHash, count: 1, expiresAt: new Date(Date.now() + 600000) }, update: { count: { increment: 1 } } });
  if (attempts.count > 12) throw fail(429, '잠시 후 다시 시도해 주세요.', { code: 'rate_limited' });
  const property = await stayProperty(input.slug);
  if (!property || !normalizeGuestStayName(input.name)) throw invalid();
  let access;
  if (input.invitation) {
    const reference = openInvitation(input.invitation, secret()) || recoverInvitation(input.invitation);
    if (!reference || reference.propertyId !== property.id) throw invalid();
    const stay = await liveStay({ kind: reference.kind, id: reference.id, propertyId: property.id });
    if (!stay || !safeEqual(normalizeGuestStayName(input.name), normalizeGuestStayName(stay.guestName))) throw invalid();
    const hash = guestStayHash(`invitation:${input.invitation}`);
    access = await prisma.guestStayAccess.findUnique({ where: { tokenHash: hash } });
    // Revoked grants stay revoked: an old private invitation cannot silently recreate one.
    if (access?.revokedAt) throw invalid();
    if (!access) {
      access = await prisma.guestStayAccess.upsert({ where: { tokenHash: hash }, update: {}, create: { id: randomUUID(),
        propertyId: property.id, reservationKind: reference.kind, reservationId: reference.id, fingerprint: stay.fingerprint,
        source: 'invitation', tokenHash: hash, tokenExpiresAt: new Date(reference.expires), expiresAt: stay.expiresAt } });
    }
  } else if (input.code) {
    access = await prisma.guestStayAccess.findUnique({ where: { codeHash: guestStayHash(normalizeStayCode(input.code)) } });
  } else if (input.accessToken && TOKEN_RE.test(input.accessToken)) {
    access = await prisma.guestStayAccess.findUnique({ where: { tokenHash: guestStayHash(input.accessToken) } });
    if (access?.tokenExpiresAt && access.tokenExpiresAt.getTime() <= Date.now()) throw invalid();
  }
  if (!access || access.propertyId !== property.id || access.revokedAt || access.expiresAt.getTime() <= Date.now()) throw invalid();
  const stay = await liveStay({ kind: access.reservationKind as StayReference['kind'], id: access.reservationId, propertyId: property.id });
  if (!stay || !safeEqual(stay.fingerprint, access.fingerprint) || !safeEqual(normalizeGuestStayName(input.name), normalizeGuestStayName(stay.guestName))) throw invalid();
  // A QR glued to a room never grants access to an arriving/future reservation.
  if (input.code && stay.phase !== 'staying') throw invalid();
  if (access.deviceId) {
    const device = await prisma.guestStayDevice.findUnique({ where: { id: access.deviceId } });
    if (!device || device.revokedAt || device.expiresAt.getTime() <= Date.now()) throw invalid();
  }
  const token = newStayToken();
  const expiresAt = new Date(Math.min(stay.expiresAt.getTime(), access.expiresAt.getTime()));
  await prisma.guestStaySession.create({ data: { id: randomUUID(), accessId: access.id, tokenHash: guestStayHash(token), expiresAt } });
  return { token, stay, expiresAt };
}

export function requestScope(stay: StayReference) { return { propertyId: stay.propertyId, reservationKind: stay.kind, reservationId: stay.id }; }
export function guestRequestDTO(row: { id: string; kind: string; details: unknown; status: string; publicReply: string; source: string;
  createdAt: Date; updatedAt: Date; version: number }): GuestStayRequestDTO {
  const snapshot = row.kind === 'tour' && row.details && typeof row.details === 'object' && 'tourSnapshot' in row.details ?
    (row.details as { tourSnapshot: GuestStayRequestDTO['tourSnapshot'] }).tourSnapshot : undefined;
  return { id: row.id, kind: row.kind as GuestStayRequestDTO['kind'], details: row.details as GuestStayRequestDTO['details'],
    status: row.status as GuestStayRequestDTO['status'], publicReply: row.publicReply, source: row.source as 'mobile' | 'pad',
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version,
    ...(snapshot ? { tourTitle: snapshot.title, durationTitle: snapshot.durationTitle, tourSnapshot: snapshot } : {}) };
}
export async function guestStayRequests(stay: StayReference) {
  return (await prisma.guestStayRequest.findMany({ where: requestScope(stay), orderBy: { createdAt: 'desc' }, take: 50 })).map(guestRequestDTO);
}
export async function guestStayDTO(stay: LiveGuestStay): Promise<GuestStayDTO> {
  const room = stay.phase === 'staying' ? await prisma.welcomepadConfig.findUnique({ where: { propertyId: stay.propertyId },
    select: { wifiSsid: true, wifiPassword: true, wifiEncryption: true } }) : null;
  return { property: stay.property, guestName: stay.guestName, checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests,
    phase: stay.phase, expiresAt: stay.expiresAt.toISOString(), room: room ? { wifiSsid: room.wifiSsid || '', wifiPassword: room.wifiPassword || '', wifiEncryption: room.wifiEncryption } : null,
    requests: await guestStayRequests(stay) };
}

function canonicalPayload(input: GuestStayRequestInput) {
  // Sort tier keys so logically identical retries produce the same fingerprint.
  const details = input.kind === 'tour' && input.details.ticketCounts ? { ...input.details,
    ticketCounts: Object.fromEntries(Object.entries(input.details.ticketCounts).sort(([a], [b]) => a.localeCompare(b))) } : input.details;
  return guestStayHash(JSON.stringify({ kind: input.kind, details }));
}
export async function createGuestStayRequest(stay: LiveGuestStay, raw: unknown, source: 'mobile' | 'pad') {
  const parsed = guestStayRequestSchema.safeParse(raw);
  if (!parsed.success) throw fail(400, '신청 내용을 확인해 주세요.', { code: 'invalid_request' });
  const input = parsed.data, payloadHash = canonicalPayload(input), scope = requestScope(stay);
  await requirePropertyModule(stay.propertyId, 'guestServices');
  if (input.kind === 'tour') await requirePropertyModule(stay.propertyId, 'tours');
  const existing = await prisma.guestStayRequest.findUnique({ where: { id: input.id } });
  if (existing) {
    if (existing.propertyId !== scope.propertyId || existing.reservationKind !== scope.reservationKind || existing.reservationId !== scope.reservationId || existing.payloadHash !== payloadHash) {
      throw fail(409, '신청 번호가 이미 사용되었습니다. 새로 신청해 주세요.', { code: 'request_conflict' });
    }
    return { request: guestRequestDTO(existing), replayed: true };
  }
  if (input.kind === 'help' && stay.phase !== 'staying') throw fail(403, '객실 요청은 체크인 후 이용할 수 있습니다.', { code: 'stay_not_started' });
  if (input.kind !== 'help' && !requestDateWithinStay(input.details, stay, Date.now(), stay.property.checkOutTime, input.kind === 'taxi')) {
    throw fail(400, '투숙 기간 안의 예정 시간을 선택해 주세요.', { code: 'invalid_request_date' });
  }
  let tourSnapshot: GuestStayRequestDTO['tourSnapshot'];
  if (input.kind === 'tour') {
    const tour = await prisma.tour.findUnique({ where: { id: input.details.tourId }, include: { durationOptions: true, ticketTiers: true } });
    if (!tour?.isActive || (tour.maxGroupSize && input.details.guests > tour.maxGroupSize)) throw fail(400, '투어 또는 참여 인원을 확인해 주세요.');
    if (input.details.durationOptionId && !tour.durationOptions.some(option => option.id === input.details.durationOptionId)) throw fail(400, '투어 코스를 다시 선택해 주세요.');
    if (tour.durationOptions.length && !input.details.durationOptionId) throw fail(400, '투어 코스를 선택해 주세요.');
    if (tour.ticketTiers.length && !input.details.ticketCounts) throw fail(400, '티켓 종류와 참여 인원을 선택해 주세요.');
    if (input.details.ticketCounts) {
      const counts = Object.entries(input.details.ticketCounts);
      if (counts.some(([id]) => !tour.ticketTiers.some(tier => tier.id === id)) || counts.reduce((sum, [, count]) => sum + count, 0) !== input.details.guests) throw fail(400, '티켓 종류와 참여 인원을 확인해 주세요.');
    }
    const option = tour.durationOptions.find(o => o.id === input.details.durationOptionId);
    const ticketSelections = tour.ticketTiers.filter(t => (input.details.ticketCounts?.[t.id] || 0) > 0).map(t => ({ id: t.id,
      label: t.label, count: input.details.ticketCounts![t.id], unitPrice: Number(t.price) }));
    tourSnapshot = { title: tour.title, durationTitle: option?.label || (option ? `${option.durationMin}분` : ''),
      // Existing listings distinguish ticket pricing and course pricing; preserve that basis instead of inventing a per-person total.
      price: ticketSelections.length ? ticketSelections.reduce((sum, t) => sum + t.count * t.unitPrice, 0) : option ? Number(option.price) : tour.basePrice === null ? null : Number(tour.basePrice),
      pricingBasis: ticketSelections.length ? 'tickets' : option ? 'course' : 'reference', ticketSelections };
  }
  // Serialize per reservation: retries/racing mobile and pad submissions cannot exceed the bound.
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${stay.propertyId}:${stay.kind}:${stay.id}`}))`;
    const duplicate = await tx.guestStayRequest.findUnique({ where: { id: input.id } });
    if (duplicate) {
      if (duplicate.propertyId !== scope.propertyId || duplicate.reservationKind !== scope.reservationKind || duplicate.reservationId !== scope.reservationId || duplicate.payloadHash !== payloadHash) throw fail(409, '신청 번호가 이미 사용되었습니다.');
      return { request: guestRequestDTO(duplicate), replayed: true };
    }
    if (await tx.guestStayRequest.count({ where: scope }) >= 50) throw fail(429, '신청이 많습니다. 직원에게 문의해 주세요.');
    const row = await tx.guestStayRequest.create({ data: { id: input.id, ...scope, guestName: stay.guestName, kind: input.kind,
      details: tourSnapshot ? { ...input.details, tourSnapshot } : input.details, source, payloadHash } });
    return { request: guestRequestDTO(row), replayed: false };
  });
}

export async function issueGuestStayAccess(stay: LiveGuestStay, userId: string) {
  const code = newStayCode(), token = newStayToken();
  const access = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-access:${stay.propertyId}:${stay.kind}:${stay.id}`}))`;
    // A fresh issuance rotates every old credential for this reservation, including invitation/device sessions.
    await tx.guestStayAccess.updateMany({ where: { ...requestScope(stay), revokedAt: null }, data: { revokedAt: new Date() } });
    return tx.guestStayAccess.create({ data: { id: randomUUID(), ...requestScope(stay), fingerprint: stay.fingerprint,
      source: 'manual', codeHash: guestStayHash(normalizeStayCode(code)), tokenHash: guestStayHash(token), tokenExpiresAt: stay.expiresAt,
      expiresAt: stay.expiresAt, createdBy: userId } });
  });
  return { accessId: access.id, code, expiresAt: stay.expiresAt.toISOString(), path: `/stay/${stay.property.slug}`,
    privatePath: `/stay/${stay.property.slug}?accessToken=${token}` };
}

export async function requireStayDevice(req: Request) {
  const token = /^Bearer (gst_device_[A-Za-z0-9_-]{43})$/.exec(req.headers.get('authorization') || '')?.[1];
  if (!token) throw fail(401, '패드를 연결해 주세요.', { code: 'device_required' });
  const device = await prisma.guestStayDevice.findUnique({ where: { tokenHash: guestStayHash(token) } });
  if (!device || !device.pairedAt || device.revokedAt || device.expiresAt.getTime() <= Date.now()) throw fail(401, '패드 연결이 만료되었거나 해제되었습니다.', { code: 'device_revoked' });
  await requirePropertyModule(device.propertyId, 'guestServices');
  return device;
}
export async function currentDeviceStay(propertyId: string) {
  const today = todayKst();
  const [events, bookings] = await Promise.all([
    prisma.event.findMany({ where: { propertyId, type: 'reservation', OR: [{ source: null }, { source: { not: 'maintenance' } }], channelId: { in: ['beds24', 'direct'] }, startDate: { lte: today }, endDate: { gte: today } }, select: { id: true, originalUid: true }, take: 10 }),
    prisma.booking.findMany({ where: { propertyId, status: 'confirmed', checkIn: { lte: today }, checkOut: { gte: today } }, select: { id: true, channelBookingRef: true, checkout: { select: { beds24Id: true } } }, take: 10 }),
  ]);
  // Direct bookings can also be imported as a Beds24 event; deduplicate by exact channel identity only.
  const ids = new Set(events.map(e => e.originalUid).filter(Boolean));
  const refs: StayReference[] = [...events.map(e => ({ kind: 'event' as const, id: e.id, propertyId })),
    ...bookings.filter(b => !ids.has(b.channelBookingRef || b.checkout?.beds24Id || '')).map(b => ({ kind: 'booking' as const, id: b.id, propertyId }))];
  const stays = (await Promise.all(refs.map(ref => liveStay(ref)))).filter((stay): stay is LiveGuestStay => !!stay && stay.phase === 'staying');
  if (stays.length > 1 || events.length >= 10 || bookings.length >= 10) throw fail(409, '현재 투숙 예약을 확인해 주세요.', { code: 'ambiguous_stay' });
  return stays[0] || null;
}
export async function deviceGuestStayQR(device: { id: string; propertyId: string }) {
  await cleanupGuestStayData();
  const stay = await currentDeviceStay(device.propertyId);
  if (!stay) return { stay: null, privatePath: null, stayProof: null };
  const token = newStayToken(), tokenExpiresAt = new Date(Math.min(Date.now() + 10 * 60000, stay.expiresAt.getTime()));
  await prisma.$transaction(async tx => {
    // Expired QR grants keep authenticated sessions alive until checkout; only QR lookup is short-lived.
    // Unused grants expire normally. A paired pad reload never invalidates guests already using their phones.
    await tx.guestStayAccess.create({ data: { id: randomUUID(), ...requestScope(stay), fingerprint: stay.fingerprint, source: 'device',
      tokenHash: guestStayHash(token), tokenExpiresAt, deviceId: device.id, expiresAt: stay.expiresAt } });
  });
  return { stay: await guestStayDTO(stay), privatePath: `/stay/${stay.property.slug}?accessToken=${token}`,
    qrExpiresAt: tokenExpiresAt.toISOString(), stayProof: deviceStayProof(device.id, stay) };
}

export function deviceStayProof(deviceId: string, stay: LiveGuestStay) {
  return createHmac('sha256', secret()).update(JSON.stringify(['guest-stay-device', deviceId, stay.propertyId, stay.kind, stay.id, stay.fingerprint])).digest('base64url');
}
export function requireDeviceStayProof(deviceId: string, stay: LiveGuestStay, proof: unknown) {
  if (typeof proof !== 'string' || !TOKEN_RE.test(proof) || !safeEqual(proof, deviceStayProof(deviceId, stay))) {
    throw fail(409, '투숙 예약이 변경되었습니다. 신청 화면을 다시 열어 주세요.', { code: 'stay_changed' });
  }
}

/** Bounded cleanup removes unused short-lived QR grants while retaining active sessions and request history. */
export async function cleanupGuestStayData() {
  const now = new Date(), old = new Date(Date.now() - 30 * 86400000);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM guest_stay_sessions WHERE id IN (
      SELECT id FROM guest_stay_sessions WHERE expires_at < ${old} OR revoked_at < ${old} LIMIT 100
    )`;
    await tx.$executeRaw`DELETE FROM guest_stay_accesses WHERE id IN (
      SELECT a.id FROM guest_stay_accesses a WHERE NOT EXISTS (SELECT 1 FROM guest_stay_sessions s WHERE s.access_id=a.id)
      AND ((a.source='device' AND a.token_expires_at < ${now}) OR a.expires_at < ${old} OR a.revoked_at < ${old}) LIMIT 100
    )`;
    await tx.$executeRaw`DELETE FROM guest_stay_devices WHERE id IN (
      SELECT d.id FROM guest_stay_devices d WHERE (d.expires_at < ${old} OR d.revoked_at < ${old}
      OR (d.paired_at IS NULL AND d.pairing_expires_at < ${now}))
      AND NOT EXISTS (SELECT 1 FROM guest_stay_accesses a WHERE a.device_id=d.id) LIMIT 20
    )`;
    await tx.$executeRaw`DELETE FROM guest_stay_attempts WHERE key_hash IN (
      SELECT key_hash FROM guest_stay_attempts WHERE expires_at < ${old} LIMIT 100
    )`;
  });
}
