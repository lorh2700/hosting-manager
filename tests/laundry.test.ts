import { test,beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLaundry,parseLaundryCreation,laundryRecordedDate,receiveLaundry,laundryStatus,isLaundryAwaitingReceipt } from '../lib/laundry';
import { GET,POST,PATCH } from '../app/api/laundry/route';
import { db,resetDb } from './stubs/prisma';
import { actAsCleaner,actAsAnonymous,actAsAdmin } from './stubs/auth';
import { makeRequest,callRoute } from './helpers/beds24-mock';
const id='18aa9e72-4728-4a64-bb38-d77d4a74dd02';
const item={name:'수건',sent:30,received:0,damaged:0,rewash:0};
beforeEach(()=>{resetDb();actAsCleaner(['p1']);db.property=[{id:'p1',name:'별하재',ownerId:'host-1'},{id:'p2',name:'외부',ownerId:'other'}];db.laundryBatch=[{id,propertyId:'p1',version:1,status:'collected',items:[{...item}],history:[]}];});
test('partial delivery retains shortage then finishes exactly',()=>{const partial=receiveLaundry([item],[{name:'수건',quantity:28,damaged:1,rewash:0}]);assert.equal(laundryStatus(partial),'partial');assert.equal(partial[0].sent-partial[0].received,2);const final=receiveLaundry(partial,[{name:'수건',quantity:2,damaged:0,rewash:0}]);assert.equal(laundryStatus(final),'completed');assert.equal(final[0].damaged,1);});
test('negative fractional unknown and excess receipts rejected',()=>{for(const quantity of [-1,1.5,31])assert.throws(()=>receiveLaundry([item],[{name:'수건',quantity,damaged:0,rewash:0}]));assert.throws(()=>receiveLaundry([item],[{name:'unknown',quantity:1,damaged:0,rewash:0}]));assert.throws(()=>receiveLaundry([item],[{name:'수건',quantity:1,damaged:2,rewash:0}]));});
test('invalid calendar dates and premature receipts rejected',()=>{const data={id,propertyId:'p1',pickupDate:'2026-02-30',deliveryDate:'2026-03-01',vendor:'업체',items:[item]};assert.equal(createLaundry.safeParse(data).success,false);assert.equal(createLaundry.safeParse({...data,pickupDate:'2026-02-28',items:[{...item,received:1}]}).success,false);});
test('unauthenticated and foreign-property access denied',async()=>{actAsAnonymous();assert.equal((await callRoute(GET,makeRequest({}))).status,401);actAsCleaner(['p2']);assert.equal((await callRoute(PATCH,makeRequest({id,version:1,action:'receive',incoming:[{name:'수건',quantity:1}]}))).status,403);assert.equal(db.laundryBatch[0].items[0].received,0);});
test('server applies receipt once and records authoritative actor',async()=>{const body={id,version:1,action:'receive',incoming:[{name:'수건',quantity:28}]};assert.equal((await callRoute(PATCH,makeRequest(body))).status,200);assert.equal(db.laundryBatch[0].status,'partial');assert.equal(db.laundryBatch[0].version,2);assert.equal(db.laundryBatch[0].history[0].actorId,'cleaner-1');assert.equal((await callRoute(PATCH,makeRequest(body))).status,409);assert.equal(db.laundryBatch[0].items[0].received,28);});
test('completed batch can be reopened through reasoned correction',async()=>{db.laundryBatch[0].status='completed';db.laundryBatch[0].items=[{...item,received:30}];assert.equal((await callRoute(PATCH,makeRequest({id,version:1,action:'correct',note:'실물 재확인',items:[{...item,received:28}]}))).status,200);assert.equal(db.laundryBatch[0].status,'partial');});
test('creation retry retains one batch and unauthorized property rejected',async()=>{db.laundryBatch=[];const body={id,propertyId:'p1',pickupDate:'2026-09-14',deliveryDate:'2026-09-15',vendor:'업체',items:[item]};assert.equal((await callRoute(POST,makeRequest(body))).status,201);assert.equal((await callRoute(POST,makeRequest(body))).status,200);assert.equal(db.laundryBatch.length,1);assert.equal((await callRoute(POST,makeRequest({...body,id:'25aa9e72-4728-4a64-bb38-d77d4a74dd02',propertyId:'p2'}))).status,403);});
test('admin sees all, cleaner sees only assigned property',async()=>{db.laundryBatch.push({...db.laundryBatch[0],id:'other',propertyId:'p2'});assert.equal((await callRoute(GET,makeRequest({}))).body.batches.length,1);actAsAdmin();assert.equal((await callRoute(GET,makeRequest({}))).body.batches.length,2);});

test('schedule corrections validate dates and retain quantities',async()=>{const body={id,version:1,action:'schedule',schedule:{pickupDate:'2026-09-14',deliveryDate:'2026-09-17',vendor:'업체',vendorPhone:'',notes:'문 앞'}};assert.equal((await callRoute(PATCH,makeRequest(body))).status,200);assert.equal(db.laundryBatch[0].deliveryDate,'2026-09-17');assert.equal(db.laundryBatch[0].items[0].sent,30);assert.equal((await callRoute(PATCH,makeRequest({...body,version:2,schedule:{...body.schedule,deliveryDate:'2026-09-13'}}))).status,400);});

test('already-sent creation records collection now while ordinary registration stays scheduled', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-03', vendor: '업체', items: [item] };
  const before = Date.now();
  const sent = await callRoute(POST, makeRequest({ ...input, collected: true }));
  assert.equal(sent.status, 201); assert.equal(sent.body.status, 'collected');
  assert.ok(new Date(sent.body.collectedAt).getTime() >= before); assert.equal(sent.body.version, 1);
  assert.equal(sent.body.items[0].received, 0);
  const scheduled = await callRoute(POST, makeRequest({ ...input, id: '25aa9e72-4728-4a64-bb38-d77d4a74dd02' }));
  assert.equal(scheduled.status, 201); assert.equal(scheduled.body.status, 'scheduled'); assert.equal(scheduled.body.collectedAt, null);
});

test('zero quantities do not create laundry and changed retry content conflicts', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-03', vendor: '업체', items: [item], collected: true };
  assert.equal((await callRoute(POST, makeRequest({ ...input, items: [{ ...item, sent: 0 }] }))).status, 400);
  assert.equal(db.laundryBatch.length, 0);
  assert.equal((await callRoute(POST, makeRequest(input))).status, 201);
  for (const patch of [{ vendor: '다른 업체' }, { collected: false }, { deliveryDate: '2026-10-04' }, { items: [{ ...item, sent: 20 }] }]) {
    assert.equal((await callRoute(POST, makeRequest({ ...input, ...patch }))).status, 409);
  }
  assert.equal(db.laundryBatch.length, 1); assert.equal(db.laundryBatch[0].items[0].sent, 30);
});

test('original creation retry succeeds after receipt and schedule edits', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-03', vendor: '업체', items: [item], collected: true };
  await callRoute(POST, makeRequest(input));
  assert.equal((await callRoute(PATCH, makeRequest({ id, version: 1, action: 'receive', incoming: [{ name: '수건', quantity: 5 }] }))).status, 200);
  assert.equal((await callRoute(PATCH, makeRequest({ id, version: 2, action: 'schedule', schedule: { pickupDate: '2026-10-02', deliveryDate: '2026-10-04', vendor: '수정 업체', vendorPhone: '', notes: '' } }))).status, 200);
  const retry = await callRoute(POST, makeRequest(input));
  assert.equal(retry.status, 200); assert.equal(retry.body.items[0].received, 5); assert.equal(retry.body.vendor, '수정 업체');
  assert.equal(db.laundryBatch.length, 1);
});

test('concurrent laundry creation with one UUID produces one batch', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-03', vendor: '업체', items: [item] };
  const results = await Promise.all([callRoute(POST, makeRequest(input)), callRoute(POST, makeRequest(input))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal(db.laundryBatch.length, 1);
});

test('receive-only status filter excludes scheduled, completed and cancelled batches', () => {
  for (const status of ['collected', 'washing', 'shipping', 'partial']) assert.equal(isLaundryAwaitingReceipt(status), true);
  for (const status of ['scheduled', 'completed', 'cancelled', 'unknown']) assert.equal(isLaundryAwaitingReceipt(status), false);
});

test('laundry query can scope one property and rejects a foreign requested property', async () => {
  db.laundryBatch.push({ ...db.laundryBatch[0], id: 'other', propertyId: 'p2' });
  assert.equal((await callRoute(GET, makeRequest({}, 'http://localhost/api/laundry?propertyId=p2'))).status, 403);
  actAsAdmin();
  const result = await callRoute(GET, makeRequest({}, 'http://localhost/api/laundry?propertyId=p1'));
  assert.equal(result.body.batches.length, 1); assert.equal(result.body.batches[0].propertyId, 'p1');
});

test('quantity-only sending records Seoul record date with unknown vendor and delivery date', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T15:30:00Z') });
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', quickSend: true, items: [{ name: '이불커버', sent: 3 }, { name: '매트', sent: 2 }], notes: '문 앞에 전달', createdBy: 'other', status: 'completed' };
  const result = await callRoute(POST, makeRequest(input));
  assert.equal(result.status, 201); assert.equal(result.body.status, 'collected'); assert.equal(result.body.pickupDate, '2026-10-02');
  assert.equal(result.body.deliveryDate, ''); assert.equal(result.body.vendor, ''); assert.equal(result.body.vendorPhone, '');
  assert.equal(result.body.createdBy, 'cleaner-1'); assert.equal(result.body.collectedAt.toISOString(), '2026-10-01T15:30:00.000Z');
  assert.deepEqual(result.body.items, [
    { name: '이불커버', sent: 3, received: 0, damaged: 0, rewash: 0 },
    { name: '매트', sent: 2, received: 0, damaged: 0, rewash: 0 },
  ]);
  const history = result.body.history[0];
  assert.equal(history.action, '빠른 보냄 기록'); assert.equal(history.pickupDateSource, 'recorded'); assert.equal(history.recordedDate, '2026-10-02');
  assert.equal(history.actorId, 'cleaner-1'); assert.equal(history.request.quickSend, true);
  for (const field of ['pickupDate', 'deliveryDate', 'vendor', 'vendorPhone', 'collected', 'createdBy']) assert.ok(!(field in history.request));
});

test('Seoul record date crosses midnight independently of the server UTC calendar date', () => {
  assert.equal(laundryRecordedDate(new Date('2026-10-01T14:59:59Z')), '2026-10-01');
  assert.equal(laundryRecordedDate(new Date('2026-10-01T15:00:00Z')), '2026-10-02');
  assert.equal(laundryRecordedDate(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
});

test('quick sending validates quantities and rejects mixed confirmed details', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', quickSend: true, items: [{ name: '수건', sent: 3 }] };
  for (const quantity of [0, -1, 1.5, 10001]) assert.equal((await callRoute(POST, makeRequest({ ...input, items: [{ name: '수건', sent: quantity }] }))).status, 400);
  assert.equal((await callRoute(POST, makeRequest({ ...input, items: [{ name: '수건', sent: 3, received: 1 }] }))).status, 400);
  for (const details of [{ pickupDate: '2026-10-02' }, { deliveryDate: '' }, { vendor: '업체' }, { vendorPhone: '' }, { collected: false }, { collected: true }]) {
    assert.equal((await callRoute(POST, makeRequest({ ...input, ...details }))).status, 400);
  }
  assert.equal((db.laundryBatch || []).length, 0);
});

test('quick UUID retry on a later Seoul day returns the original record after receipt and detail updates', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T15:30:00Z') });
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', quickSend: true, items: [{ name: '수건', sent: 3 }] };
  assert.equal((await callRoute(POST, makeRequest(input))).status, 201);
  context.mock.timers.setTime(Date.UTC(2026, 9, 2, 15, 30));
  const later = await callRoute(POST, makeRequest(input));
  assert.equal(later.status, 200); assert.equal(later.body.pickupDate, '2026-10-02');
  assert.equal((await callRoute(PATCH, makeRequest({ id, version: 1, action: 'receive', incoming: [{ name: '수건', quantity: 1 }] }))).status, 200);
  assert.equal((await callRoute(PATCH, makeRequest({ id, version: 2, action: 'schedule', schedule: { pickupDate: '2026-10-01', deliveryDate: '2026-10-04', vendor: '확인 업체', vendorPhone: '', notes: '추가 확인' } }))).status, 200);
  const retried = await callRoute(POST, makeRequest(input));
  assert.equal(retried.status, 200); assert.equal(retried.body.pickupDate, '2026-10-01'); assert.equal(retried.body.vendor, '확인 업체');
  assert.equal(retried.body.items[0].received, 1); assert.equal(retried.body.version, 3); assert.equal(db.laundryBatch.length, 1);
});

test('quick UUID cannot be reused with different quantities, notes or sending mode', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', quickSend: true, items: [{ name: '수건', sent: 3 }] };
  await callRoute(POST, makeRequest(input));
  assert.equal((await callRoute(POST, makeRequest({ ...input, items: [{ name: '수건', sent: 2 }] }))).status, 409);
  assert.equal((await callRoute(POST, makeRequest({ ...input, notes: '새 메모' }))).status, 409);
  assert.equal((await callRoute(POST, makeRequest({ id, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-03', vendor: '업체', collected: true, items: [{ name: '수건', sent: 3 }] }))).status, 409);
  assert.equal(db.laundryBatch.length, 1);
});

test('concurrent quantity-only sends with one UUID create once and keep property access restrictions', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', quickSend: true, items: [{ name: '수건', sent: 3 }] };
  const results = await Promise.all([callRoute(POST, makeRequest(input)), callRoute(POST, makeRequest(input))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]); assert.equal(db.laundryBatch.length, 1);
  actAsCleaner(['p2']); assert.equal((await callRoute(POST, makeRequest(input))).status, 403);
  actAsAnonymous(); assert.equal((await callRoute(POST, makeRequest(input))).status, 401);
  assert.equal(db.laundryBatch.length, 1);
});

test('detailed scheduled registration still requires vendor and dates and cannot change to quick mode', async () => {
  db.laundryBatch = [];
  const input = { id, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-03', vendor: '업체', items: [item] };
  for (const removed of ['vendor', 'pickupDate', 'deliveryDate']) {
    const incomplete = Object.fromEntries(Object.entries(input).filter(([key]) => key !== removed));
    assert.equal(parseLaundryCreation(incomplete).success, false);
    assert.equal((await callRoute(POST, makeRequest(incomplete))).status, 400);
  }
  assert.equal((await callRoute(POST, makeRequest(input))).status, 201); assert.equal(db.laundryBatch[0].status, 'scheduled');
  assert.equal((await callRoute(POST, makeRequest({ id, propertyId: 'p1', quickSend: true, items: [item] }))).status, 409);
  assert.equal(db.laundryBatch.length, 1);
});

test('legacy laundry histories without request metadata remain detailed-retry compatible', async () => {
  const input = { id, propertyId: 'p1', pickupDate: '2026-10-02', deliveryDate: '2026-10-03', vendor: '업체', items: [item] };
  db.laundryBatch = [{ ...input, vendorPhone: '', notes: '', createdBy: 'cleaner-1', status: 'collected', version: 2, history: [{ action: '등록', items: [item] }] }];
  const retried = await callRoute(POST, makeRequest(input));
  assert.equal(retried.status, 200); assert.equal(retried.body.status, 'collected'); assert.equal(db.laundryBatch.length, 1);
});
