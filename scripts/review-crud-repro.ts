/** Read-only toward production: all infrastructure is replaced by tests/register.mjs.
 * Run: node --experimental-strip-types --no-warnings --import ./tests/register.mjs scripts/review-crud-repro.ts
 * These observations capture review findings, not desired regression-test expectations.
 */
import { db, resetDb } from '../tests/stubs/prisma';
import { actAsAdmin, actAsCleaner, actAsManager } from '../tests/stubs/auth';
import { callRoute, makeRequest } from '../tests/helpers/beds24-mock';
import { POST as messagePost, GET as messageGet } from '../app/api/messages/route';
import { PUT as eventPut } from '../app/api/events/route';
import { GET as integrationGet } from '../app/api/integrations/route';
import { PUT as applicationPut } from '../app/api/cleaning-applications/route';

resetDb(); actAsCleaner(['p1']);
db.event = [{ id: 'other-event', propertyId: 'p2' }];
let result = await callRoute(messagePost, makeRequest({ eventId: 'other-event', text: 'review fixture', sender: 'host' }));
console.log(JSON.stringify({ finding: 'message-create-outside-scope', status: result.status, savedEvent: db.message?.[0]?.eventId }));

resetDb(); actAsCleaner([]);
db.cleaning = [{ id: 'past-cleaning', propertyId: 'p2', cleanerId: 'cleaner-1', date: '2020-01-01', status: 'done' }];
db.message = [{ id: 'new-message', propertyId: 'p2', text: 'fixture private message', createdAt: new Date() }];
result = await callRoute(messageGet, makeRequest({}, 'http://localhost/api/messages'));
console.log(JSON.stringify({ finding: 'message-read-after-scope-revoked', status: result.status, returnedIds: result.body.map((m: {id: string}) => m.id) }));

resetDb(); actAsAdmin();
db.event = [{ id: 'paid-event', propertyId: 'p1', channelId: 'beds24', originalUid: '123', startDate: '2026-10-01', endDate: '2026-10-04' }];
db.checkoutOrder = [{ id: 'order', beds24Id: '123', status: 'paid' }];
const canonical = await callRoute(eventPut, makeRequest({ id: 'paid-event', startDate: '2026-10-02' }));
const alias = await callRoute(eventPut, makeRequest({ id: 'paid-event', start: '2026-10-02' }));
console.log(JSON.stringify({ finding: 'paid-event-date-alias', canonicalStatus: canonical.status, aliasStatus: alias.status, savedStart: db.event[0].startDate }));

resetDb(); actAsAdmin();
db.integration = [{ id: 'integration', propertyId: 'p1', provider: 'airbnb', status: 'active' }];
db.syncLog = [{ id: 'real-log', propertyId: 'p1', result: { eventsCreated: 3 } }];
result = await callRoute(integrationGet, makeRequest({}, 'http://localhost/api/integrations?type=sync_logs&limit=50'));
console.log(JSON.stringify({ finding: 'sync-log-contract', status: result.status, returned: result.body }));

resetDb(); actAsManager(['p1']);
db.cleaningApplication = [{ id: 'application', propertyId: 'p1', applicantId: 'someone-else', status: 'pending' }];
result = await callRoute(applicationPut, makeRequest({ id: 'application', status: 'rejected' }));
console.log(JSON.stringify({ finding: 'manager-reject-owned-property-application', status: result.status, savedStatus: db.cleaningApplication[0].status }));
