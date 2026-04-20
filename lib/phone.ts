/**
 * Phone-based account utilities for cleaners.
 *
 * A Cleaner's login identity is their phone number. We store a synthetic
 * email on the linked User so the existing email-unique constraint keeps
 * working without schema changes. Login accepts either the real email or
 * the phone; phone is normalized before lookup.
 */

const SYNTHETIC_EMAIL_DOMAIN = 'cleaner.va';

/** Strip all non-digits, collapse international prefix. Returns digits-only. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  // +82 10 1234 5678 → 821012345678 → 01012345678
  if (digits.startsWith('82') && digits.length >= 11) {
    digits = '0' + digits.slice(2);
  }
  if (digits.length < 9 || digits.length > 11) return null;
  return digits;
}

/** Last 4 digits — used as the default password for phone-based accounts. */
export function lastFourDigits(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 4) return null;
  return normalized.slice(-4);
}

/** Synthetic email stored on User.email for phone-based cleaner accounts. */
export function phoneToSyntheticEmail(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `${normalized}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** True if the email is a synthetic one we generated from a phone number. */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`);
}
