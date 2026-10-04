import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { propertyPublicInfo, publicInfoSchema, publishRequirements } from '../lib/property-public-info';
import { PUT } from '../app/api/properties/[id]/route';
import { POST as CREATE } from '../app/api/properties/route';
import { GET as PUBLIC } from '../app/api/public/properties/route';
import { GET as DETAIL } from '../app/api/public/properties/[id]/route';
import { POST as SEARCH } from '../app/api/public/stay-search/route';
import { db, resetDb } from './stubs/prisma';
import { actAsAdmin, actAsBusinessAdmin } from './stubs/auth';
import { makeRequest, setFetchHandler, resetFetch, fetchLog, json } from './helpers/beds24-mock';

const publicInfo = { region: '서울 종로', addressKo: '서울 종로구 새 숙소 1', catchphrase: '새로운 쉼', checkInTime: '15:00', checkOutTime: '11:00', images: ['https://storage.example.com/new.webp'] };
const property = { id: 'new-id', slug: 'new-stay', name: '새 숙소', timezone: 'Asia/Seoul', organizationId: 'o1', status: 'coming_soon', description: '새 숙소 소개', maxGuests: 6, beds24PropId: '111', beds24RoomId: '555', publicInfo, featureOverrides: {}, featureVersion: 1 };
const ctx = { params: Promise.resolve({ id: 'new-id' }) };
beforeEach(() => { resetDb(); resetFetch(); actAsAdmin(); db.organization = [{ id: 'o1', status: 'active', features: {} }, { id: 'o2', status: 'active', features: {} }]; db.property = [structuredClone(property)]; db.user = [{ id: 'admin-1', role: 'super_admin', status: 'active' }]; });

test('새 지점 공개 정보는 DB의 사진·주소를 사용하고 기존 지점은 로컬 사진으로 시작한다', () => {
  assert.deepEqual(propertyPublicInfo(property), publicInfo);
  assert.ok(propertyPublicInfo({ slug: 'anon', publicInfo: {} }).images[0].startsWith('/images/anon/'));
  for (const images of [['javascript:alert(1)'], ['http://example.com/a.jpg'], ['https://user:password@example.com/a.jpg'], ['/images/../private'], ['/images/%2e%2e/private'], ['/images/a%']]) assert.equal(publicInfoSchema.safeParse({ ...publicInfo, images }).success, false);
  assert.equal(publicInfoSchema.safeParse({ ...publicInfo, checkInTime: '25:00' }).success, false);
});

test('준비 정보가 누락된 지점은 공개되지 않고 준비 완료 후 공개된다', async () => {
  db.property[0].publicInfo.images = [];
  assert.deepEqual(publishRequirements(db.property[0] as typeof property), ['사진']);
  const rejected: any = await PUT(makeRequest({ status: 'active' }, 'http://localhost/api/properties/new-id'), ctx);
  assert.equal(rejected.status, 400); assert.equal(db.property[0].status, 'coming_soon');
  const accepted: any = await PUT(makeRequest({ status: 'active', publicInfo }, 'http://localhost/api/properties/new-id'), ctx);
  assert.equal(accepted.status, 200); assert.equal(db.property[0].status, 'active'); assert.deepEqual(accepted.body.publishMissing, []);
  const invalidEdit: any = await PUT(makeRequest({ publicInfo: { ...publicInfo, images: [] } }, 'http://localhost/api/properties/new-id'), ctx);
  assert.equal(invalidEdit.status, 400); assert.deepEqual(db.property[0].publicInfo.images, publicInfo.images);
});

test('사업자 관리자는 다른 사업자의 공개 정보를 수정할 수 없다', async () => {
  actAsBusinessAdmin('o2', []);
  const response: any = await PUT(makeRequest({ publicInfo }, 'http://localhost/api/properties/new-id'), ctx);
  assert.equal(response.status, 403); assert.equal(db.property[0].organizationId, 'o1');
});

test('공개 중인 주소 변경과 잘못된 인원·사진 설정은 거부된다', async () => {
  db.property[0].status = 'active';
  assert.equal((await PUT(makeRequest({ slug: 'other-stay' }, 'http://localhost/api/properties/new-id'), ctx) as any).status, 409);
  for (const input of [{ maxGuests: 20 }, { maxGuests: 1 }, { publicInfo: { ...publicInfo, images: ['file:///secret'] } }]) assert.equal((await PUT(makeRequest(input, 'http://localhost/api/properties/new-id'), ctx) as any).status, 400);
});

test('직접 추가한 지점도 준비 중으로 시작한다', async () => {
  const response: any = await CREATE(makeRequest({ name: '새 지점', organizationId: 'o1' }, 'http://localhost/api/properties'), { params: Promise.resolve({}) });
  assert.equal(response.status, 201); assert.equal(response.body.status, 'coming_soon'); assert.equal(response.body.maxGuests, 2);
});

test('코드 등록 없이 새 지점의 공개 목록과 상세 페이지가 연결되며 내부 정보는 반환하지 않는다', async () => {
  db.property[0].doorPassword = 'PRIVATE'; db.property[0].status = 'active';
  const list: any = await PUBLIC(makeRequest({}, 'http://localhost/api/public/properties'), { params: Promise.resolve({}) });
  assert.equal(list.body[0].slug, 'new-stay'); assert.deepEqual(list.body[0].images, publicInfo.images); assert.equal(list.body[0].doorPassword, undefined);
  const detail: any = await DETAIL(makeRequest({}, 'http://localhost/api/public/properties/new-stay'), { params: Promise.resolve({ id: 'new-stay' }) });
  assert.equal(detail.status, 200); assert.equal(detail.body.addressKo, publicInfo.addressKo); assert.equal(detail.body.beds24RoomId, undefined);
});

test('중지된 사업자와 비활성 예약 지점은 공개 조회에서 제외된다', async () => {
  for (const disable of [() => { db.organization[0].status = 'suspended'; }, () => { db.property[0].featureOverrides = { reservations: false }; }]) {
    db.organization[0].status = 'active'; db.property[0].featureOverrides = {}; disable();
    assert.deepEqual((await PUBLIC(makeRequest({}, 'http://localhost/api/public/properties'), { params: Promise.resolve({}) }) as any).body, []);
    assert.equal((await DETAIL(makeRequest({}, 'http://localhost/api/public/properties/new-stay'), { params: Promise.resolve({ id: 'new-stay' }) }) as any).status, 404);
  }
});

test('새 슬러그의 예약 검색은 활성 지점만 조회하고 비활성 지점에는 원격 호출하지 않는다', async () => {
  db.property[0].status = 'active'; process.env.CHECKOUT_BEDS24_OFFER_ID = '1'; process.env.CHECKOUT_PRICE_INCLUDES_ALL_FEES = 'true';
  setFetchHandler(url => {
    if (url.pathname.endsWith('/authentication/token')) return json({ token: 'token', expiresIn: 86400 });
    if (url.pathname.endsWith('/properties')) return json({ data: [{ id: 111, currency: 'KRW' }] });
    if (url.pathname.endsWith('/inventory/rooms/offers')) return json({ data: [{ roomId: 555, offers: [{ offerId: 1, price: 300000, unitsAvailable: 1 }] }] });
    throw new Error('Unexpected request');
  });
  const input = { checkIn: '2027-10-01', checkOut: '2027-10-03', guests: 2, pets: 0 };
  const response: any = await SEARCH(makeRequest(input, 'http://localhost/api/public/stay-search'), { params: Promise.resolve({}) });
  assert.equal(response.body.results[0].slug, 'new-stay'); assert.equal(response.body.results[0].status, 'available');
  resetFetch(); db.property[0].featureOverrides = { integrations: false };
  assert.deepEqual((await SEARCH(makeRequest(input, 'http://localhost/api/public/stay-search'), { params: Promise.resolve({}) }) as any).body.results, []); assert.equal(fetchLog.length, 0);
});
