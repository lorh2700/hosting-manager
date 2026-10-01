import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeKnowledgeFile, mergeKnowledge } from '../lib/inquiry-knowledge';
import { isSimpleInquiryThanks } from '../lib/inquiry-acknowledgement';

test('안내 파일은 UTF-8 텍스트만 읽으며 빈 파일, 바이너리, 크기 초과를 거부한다', () => {
  const encode = (value: string) => new TextEncoder().encode(value);
  assert.equal(decodeKnowledgeFile('안내.MD', encode('\uFEFF# 안내\r\n체크인 15시')), '# 안내\n체크인 15시');
  for (const [name, bytes] of [['a.pdf', encode('text')], ['a.txt', encode(' ')], ['a.md', encode('a\0b')],
    ['a.txt', new Uint8Array([255])], ['a.txt', new Uint8Array(65537)], ['a.txt', encode('a'.repeat(16001))]] as const) {
    assert.throws(() => decodeKnowledgeFile(name, bytes));
  }
});

test('안내문 병합은 기존 내용을 보존하며 합산 길이를 제한한다', () => {
  assert.equal(mergeKnowledge('기존 안내', '새 안내', 'append'), '기존 안내\n\n새 안내');
  assert.equal(mergeKnowledge('기존 안내', '새 안내', 'replace'), '새 안내');
  assert.throws(() => mergeKnowledge('a'.repeat(16000), '추가', 'append'));
});

test('감사 인사만 생략하고 질문·운영 알림·동의·혼합 요청은 보존한다', () => {
  for (const text of ['Thank you! 😊', '감사합니다 🙏🏻', 'Merci beaucoup!', '謝謝您', 'Thanks?']) {
    assert.equal(isSimpleInquiryThanks(text), !['謝謝您', 'Thanks?'].includes(text));
  }
  for (const text of ['Thank you, can we check in early?', '감사합니다. 체크아웃했습니다.', 'Yes thank you', 'OK', 'Thanks for booking the taxi', '고장났어요 감사합니다', '👍']) {
    assert.equal(isSimpleInquiryThanks(text), false, text);
  }
});
