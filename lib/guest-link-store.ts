import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { z } from 'zod';
import type { GuestInvitationReference } from './guest-invitation-token';

export type GuestLinkDatabase = { $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T> };
const propertySchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const referenceSchema = z.object({ kind: z.enum(['event', 'booking']), id: z.string().uuid(),
  propertyId: propertySchema, expires: z.number().int().positive().max(8_640_000_000_000_000) });
type LinkRow = { token_hash: string; purpose: 'invitation' | 'checkout'; property_id: string;
  reservation_kind: 'event' | 'booking' | null; reservation_id: string | null;
  expires_at: Date | string | null; revoked_at: Date | string | null };

export function guestLinkHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function validGuestLinkToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  return /^i2_[A-Za-z0-9_-]{22}$/.test(token) || /^[iq]1_[A-Za-z0-9_-]{43}$/.test(token) || /^[A-Za-z0-9_-]{60,1024}$/.test(token) ||
    /^[A-Za-z0-9_-]{2,171}\.[A-Za-z0-9_-]{43}$/.test(token);
}

export function createGuestLinkStore(db: GuestLinkDatabase) {
  async function row(token: string) {
    const rows = await db.$queryRaw<LinkRow[]>(Prisma.sql`SELECT token_hash,purpose,property_id,reservation_kind,reservation_id,expires_at,revoked_at
      FROM guest_link_tokens WHERE token_hash=${guestLinkHash(token)} LIMIT 1`);
    return rows[0] ?? null;
  }
  function active(link: LinkRow, now: number) {
    return !link.revoked_at && (link.expires_at === null || new Date(link.expires_at).getTime() > now);
  }
  async function register(token: string, purpose: LinkRow['purpose'], propertyId: string, reference?: GuestInvitationReference) {
    if (!validGuestLinkToken(token)) throw new Error('INVALID_GUEST_LINK_TOKEN');
    propertySchema.parse(propertyId);
    if (reference) referenceSchema.parse(reference);
    const hash = guestLinkHash(token), expires = reference ? new Date(reference.expires) : null;
    await db.$queryRaw(Prisma.sql`INSERT INTO guest_link_tokens(token_hash,purpose,property_id,reservation_kind,reservation_id,expires_at)
      VALUES(${hash},${purpose},${propertyId},${reference?.kind ?? null},${reference?.id ?? null},${expires})
      ON CONFLICT(token_hash) DO NOTHING RETURNING token_hash`);
    const saved = await row(token);
    return !!saved && active(saved, Date.now()) && saved.purpose === purpose && saved.property_id === propertyId &&
      saved.reservation_kind === (reference?.kind ?? null) && saved.reservation_id === (reference?.id ?? null) &&
      (saved.expires_at === null ? null : new Date(saved.expires_at).getTime()) === (reference?.expires ?? null);
  }
  return {
    async issueInvitation(reference: GuestInvitationReference) {
      referenceSchema.parse(reference);
      const token = `i2_${randomBytes(16).toString('base64url')}`;
      if (!await register(token, 'invitation', reference.propertyId, reference)) throw new Error('GUEST_LINK_ISSUE_FAILED');
      return token;
    },
    async issueCheckout(propertyId: string) {
      const token = `q1_${randomBytes(32).toString('base64url')}`;
      if (!await register(token, 'checkout', propertyId)) throw new Error('GUEST_LINK_ISSUE_FAILED');
      return token;
    },
    async invitation(token: unknown, now = Date.now()): Promise<{ found: boolean; reference: GuestInvitationReference | null }> {
      if (!validGuestLinkToken(token)) return { found: true, reference: null };
      const link = await row(token);
      if (!link) return { found: false, reference: null };
      if (link.purpose !== 'invitation' || !active(link, now) || !link.expires_at) return { found: true, reference: null };
      const parsed = referenceSchema.safeParse({ kind: link.reservation_kind, id: link.reservation_id,
        propertyId: link.property_id, expires: new Date(link.expires_at).getTime() });
      return { found: true, reference: parsed.success ? parsed.data : null };
    },
    async checkout(token: unknown, now = Date.now()): Promise<{ found: boolean; propertyId: string | null }> {
      if (!validGuestLinkToken(token)) return { found: true, propertyId: null };
      const link = await row(token);
      if (!link) return { found: false, propertyId: null };
      return { found: true, propertyId: link.purpose === 'checkout' && active(link, now) ? link.property_id : null };
    },
    registerInvitation: (token: string, reference: GuestInvitationReference) => register(token, 'invitation', reference.propertyId, reference),
    registerCheckout: (token: string, propertyId: string) => register(token, 'checkout', propertyId),
  };
}
