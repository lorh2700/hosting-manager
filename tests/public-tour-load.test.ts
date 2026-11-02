import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicTours } from '../lib/public-tour-load';

test('투어 조회는 성공한 빈 목록·404와 연결/서버 실패를 구분한다', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json([]);
    assert.deepEqual(await loadPublicTours('/tours'), []);
    globalThis.fetch = async () => new Response('', { status: 404 });
    assert.equal(await loadPublicTours('/tours/missing', { detail: true }), null);
    await assert.rejects(loadPublicTours('/tours'));
    globalThis.fetch = async () => new Response('', { status: 500 });
    await assert.rejects(loadPublicTours('/tours/missing', { detail: true }));
    globalThis.fetch = async () => { throw new TypeError('network'); };
    await assert.rejects(loadPublicTours('/tours'));
    globalThis.fetch = async () => Response.json({ error: 'unexpected payload' });
    await assert.rejects(loadPublicTours('/tours'));
    globalThis.fetch = async () => Response.json([{ id: 'available' }]);
    assert.deepEqual(await loadPublicTours('/tours'), [{ id: 'available' }]);
  } finally { globalThis.fetch = original; }
});
