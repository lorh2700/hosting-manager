import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneRegion, guestRegion, bedsResidenceCountry } from '../lib/guest-region';
test('reservation residence takes priority over phone country and missing later values do not erase it', () => {
  const region = guestRegion('+821012345678', [{ checkIn: '2026-02-01', residenceCountry: 'FR' }, { checkIn: '2026-03-01', residenceCountry: null }]);
  assert.equal(region.countryCode, 'FR'); assert.equal(region.source, 'reservation');
  assert.equal(bedsResidenceCountry({ country2: 'jp', country: 'France' }), 'JP');
  assert.equal(bedsResidenceCountry({ country: 'Germany' }), 'DE');
});
test('phone inference never guesses a country from domestic, masked, malformed or shared prefixes', () => {
  assert.equal(phoneRegion('+821012345678').countryCode, 'KR');
  for (const phone of ['01012345678', '821012345678', '010-****-5678', '+82', '+999123456789']) assert.equal(phoneRegion(phone).source, 'unknown');
  const shared = phoneRegion('+14155552671'); assert.equal(shared.countryCode, null); assert.equal(shared.source, 'phone');
});
