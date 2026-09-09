import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import { pollCameraInbox } from '@/lib/camera-inbox-imap';

test('read mail is included and upload failures remain visible without changing Seen', async () => {
  const oldUser = process.env.CAMERA_IMAP_USER; const oldPass = process.env.CAMERA_IMAP_PASSWORD;
  process.env.CAMERA_IMAP_USER = 'camera@test.invalid'; process.env.CAMERA_IMAP_PASSWORD = 'test';
  let criteria: unknown; let marked = false; let released = false;
  mock.method(ImapFlow.prototype, 'connect', async () => {});
  mock.method(ImapFlow.prototype, 'logout', async () => {});
  mock.method(ImapFlow.prototype, 'getMailboxLock', async () => ({ release: () => { released = true; } }));
  mock.method(ImapFlow.prototype, 'search', async (q: unknown) => { criteria = q; return [1]; });
  mock.method(ImapFlow.prototype, 'messageFlagsAdd', async () => { marked = true; });
  const mail = ['From: camera@test.invalid', 'To: camera+byulha@test.invalid', 'Message-ID: <test-image>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary=sample', '', '--sample', 'Content-Type: image/jpeg', 'Content-Disposition: attachment; filename=snap.jpg', 'Content-Transfer-Encoding: base64', '', '/9j/2Q==', '--sample--'].join('\r\n');
  mock.method(ImapFlow.prototype, 'fetchOne', async () => ({ source: Buffer.from(mail) }));
  try {
    const r = await pollCameraInbox(async () => ({ status: 'upload_failed', judged: false, leaving: false, notified: false, error: 'upload failed' }));
    assert.equal(r.checked, 1); assert.equal(r.images, 1);
    assert.equal('seen' in (criteria as object), false);
    assert.ok((criteria as { since: Date }).since instanceof Date);
    assert.match(r.errors[0], /upload failed/);
    assert.equal(marked, false); assert.equal(released, true);
  } finally {
    mock.restoreAll();
    if (oldUser === undefined) delete process.env.CAMERA_IMAP_USER; else process.env.CAMERA_IMAP_USER = oldUser;
    if (oldPass === undefined) delete process.env.CAMERA_IMAP_PASSWORD; else process.env.CAMERA_IMAP_PASSWORD = oldPass;
  }
});
