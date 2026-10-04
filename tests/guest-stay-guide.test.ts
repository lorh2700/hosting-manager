import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGuestStayGuide } from '../lib/guest-stay-guide';

test('room guide stays plain text and excludes embedded credentials and transport prices in every language', () => {
  for (const lang of ['ko', 'en', 'ja', 'zh']) for (const slug of ['anon', 'unwadang', 'hwayeonjae', 'byulha', 'dowonjae']) {
    const { sections } = getGuestStayGuide(slug, lang);
    assert.ok(sections.length > 0);
    assert.ok(sections.every(section => section.paragraphs.length > 0));
    assert.doesNotMatch(JSON.stringify(sections), /<[^>]+>|wifi|wi-fi|와이파이|password|비밀번호|100,000|공항|airport/i);
  }
});

test('equipment instructions and shower warning stay scoped to the reviewed property', () => {
  assert.ok(getGuestStayGuide('unwadang', 'ko').sections.some(section => section.id === 'shower'));
  assert.ok(!getGuestStayGuide('anon', 'ko').sections.some(section => section.id === 'shower'));
  assert.deepEqual(getGuestStayGuide('dowonjae', 'ko').sections.map(section => section.id), ['rules']);
  assert.deepEqual(getGuestStayGuide('anon', 'unsupported'), getGuestStayGuide('anon', 'en'));
});
