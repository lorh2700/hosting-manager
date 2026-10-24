import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guestInvitationPath, guestInvitationToken } from '../lib/guest-invitation-url';

const origin = 'https://voidanchae.com';
const token = 'i2_' + 'a'.repeat(22);
test('short invitation addresses preserve each supported language and stay under 60 characters', () => {
  for (const lang of ['ko', 'en', 'ja', 'zh']) {
    const path = guestInvitationPath(token, lang);
    assert.equal(path, `/i/${token}?lang=${lang}`);
    assert.ok((origin + path).length <= 60);
    assert.equal(guestInvitationToken(origin + path, origin), token);
  }
  assert.equal(new URL(guestInvitationPath(token, 'fr'), origin).searchParams.get('lang'), 'en');
  assert.throws(() => guestInvitationPath('../another/path', 'en'));
});
test('existing invitation paths remain readable and foreign origins or alternate destinations are rejected', () => {
  const old = 'v3_' + 'b'.repeat(98);
  assert.equal(guestInvitationToken(`${origin}/guest/welcome/${old}?lang=en`, origin), old);
  for (const value of [`https://example.invalid/i/${token}`, `${origin}/i/${token}/other`,
    `${origin}/stay/${token}`, `${origin}/i/${token}#other`, `https://user@voidanchae.com/i/${token}`, null]) {
    assert.equal(guestInvitationToken(value, origin), null);
  }
});
