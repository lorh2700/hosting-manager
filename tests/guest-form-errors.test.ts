import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickupRequestSchema } from '../lib/guest-guide';
import { guestStayRequestSchema } from '../lib/guest-stay';
import { guestValidationFields, readGuestFieldErrors, guestFieldMessage } from '../lib/guest-form-errors';

test('nested request errors retain field identifiers but never guest input, private fields or raw schema messages', () => {
  const invalid = guestStayRequestSchema.safeParse({ id: 'bad', kind: 'taxi', details: { date: '2026-02-31', time: '28:00', destination: '', passengers: 0, luggage: -1, privateSecret: 'sensitive' } });
  assert.equal(invalid.success, false);
  if (invalid.success) return;
  assert.deepEqual(guestValidationFields(invalid.error.issues), { date: 'invalid', time: 'invalid', destination: 'invalid', passengers: 'invalid', luggage: 'invalid' });
  assert.deepEqual(readGuestFieldErrors({ phone: 'invalid', date: 'date_unavailable', secret: 'invalid', message: 'raw private exception', '__proto__': 'invalid' }), { phone: 'invalid', date: 'date_unavailable' });
  assert.deepEqual(readGuestFieldErrors({ phone: { toString: null }, message: ['invalid'] }), {});
});
test('pickup errors identify email, phone, flight and consent and have safe copy in all guest languages', () => {
  const parsed = pickupRequestSchema.safeParse({ email: 'private invalid address', phone: 'words', flightNumber: 'invalid-flight', consent: false });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const fields = guestValidationFields(parsed.error.issues);
  for (const field of ['email', 'phone', 'flightNumber', 'consent'] as const) {
    assert.equal(fields[field], 'invalid');
    for (const language of ['ko', 'en', 'ja', 'zh'] as const) assert.ok(guestFieldMessage(language, field, fields[field]).length > 5);
  }
  assert.equal(JSON.stringify(fields).includes('private invalid address'), false);
});
