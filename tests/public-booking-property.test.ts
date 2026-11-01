import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getPublicBookingProperty } from '../lib/public-booking-property';
import { optimizedPropertyImages } from '../lib/property-images';
import { PROPERTY_DISPLAY, propertyImagePaths } from '../lib/property-display';
import { publicListing } from '../lib/property-public-info';
import { GET } from '../app/api/public/properties/[id]/route';
import { db, prismaOverrides, resetDb } from './stubs/prisma';
import { makeRequest, fetchLog, resetFetch } from './helpers/beds24-mock';

const policy = { tiers: [{ minDaysBefore: 0, refundPercent: 0 }, { minDaysBefore: 8, refundPercent: 25 },
  { minDaysBefore: 15, refundPercent: 50 }, { minDaysBefore: 22, refundPercent: 75 }, { minDaysBefore: 30, refundPercent: 100 }] };
const property = {
  id: 'oKWKVQqLy7uENyHUwljr', slug: 'unwadang', name: '운와당', status: 'active', timezone: 'Asia/Seoul',
  openingDate: null, description: '숙소 소개', maxGuests: 6, organizationId: 'org1', featureOverrides: {},
  publicInfo: { amenities: ['주방', 'Wi-Fi'], baseGuests: 2 }, refundPolicy: policy,
  cleaningFeePolicy: { baseAmount: 50000, weekendAmount: 10000 }, doorPassword: 'private-door-code',
  beds24PropId: 'private-provider-id', beds24RoomId: 'private-room-id', cameraNotes: 'private-camera',
};
beforeEach(() => {
  resetDb(); resetFetch();
  db.property = [structuredClone(property)];
  db.organization = [{ id: 'org1', status: 'active', features: {} }];
});

test('SSR과 API의 공개 숙소 DTO는 환불 규정·시설만 노출하고 내부 운영정보는 조회하지 않는다', async () => {
  let selected: Record<string, unknown> = {};
  prismaOverrides.property = { findFirst: async (args: { select: Record<string, unknown> }) => {
    selected = args.select;
    return { ...property, organization: db.organization[0] };
  } };
  const response: any = await GET(makeRequest({}), { params: Promise.resolve({ id: 'unwadang' }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(response.body, await getPublicBookingProperty('unwadang'));
  assert.deepEqual(response.body.refundPolicy, policy);
  assert.deepEqual(response.body.amenities, ['주방', 'Wi-Fi']);
  for (const key of ['cleaningFeePolicy', 'doorPassword', 'beds24PropId', 'beds24RoomId', 'cameraNotes', 'organizationId', 'publicInfo']) {
    assert.equal(Object.hasOwn(response.body, key), false, key);
    if (key !== 'publicInfo') assert.equal(Object.hasOwn(selected, key), false, `select ${key}`);
  }
  assert.equal(Object.hasOwn(response.body, 'organization'), false);
  assert.equal(Object.hasOwn(response.body, 'featureOverrides'), false);
  assert.equal(fetchLog.length, 0);
});

test('기존 문서 ID와 구 슬러그도 같은 지점을 읽고 정책 변경을 즉시 반영한다', async () => {
  assert.equal((await getPublicBookingProperty(property.id)).id, property.id);
  assert.equal((await getPublicBookingProperty('unwa')).id, property.id);
  db.property[0].refundPolicy.tiers[1].refundPercent = 30;
  assert.equal((await getPublicBookingProperty('unwadang')).refundPolicy?.tiers[1].refundPercent, 30);
  db.property[0].refundPolicy = { tiers: [{ minDaysBefore: 30, refundPercent: 100 }] };
  assert.equal((await getPublicBookingProperty('unwadang')).refundPolicy, null);
  db.property[0].refundPolicy = null;
  assert.equal((await getPublicBookingProperty('unwadang')).refundPolicy, null);
  db.property[0].slug = 'byulha';
  assert.equal((await getPublicBookingProperty('byeolha')).id, property.id);
});

test('비공개·사업자 중지·예약 비활성화 지점은 SSR과 API에서 모두 노출하지 않는다', async () => {
  const blocked = [
    () => { db.property[0].status = 'closed'; },
    () => { db.property[0].status = 'unknown'; },
    () => { db.organization[0].status = 'suspended'; },
    () => { db.property[0].featureOverrides = { reservations: false }; },
    () => { db.organization[0].features = { reservations: false }; },
  ];
  for (const change of blocked) {
    db.property = [structuredClone(property)]; db.organization = [{ id: 'org1', status: 'active', features: {} }];
    change();
    await assert.rejects(() => getPublicBookingProperty('unwadang'), (error: any) => error.status === 404);
    const response: any = await GET(makeRequest({}), { params: Promise.resolve({ id: 'unwadang' }) });
    assert.equal(response.status, 404);
  }
  await assert.rejects(() => getPublicBookingProperty(''), (error: any) => error.status === 404);
  await assert.rejects(() => getPublicBookingProperty('missing'), (error: any) => error.status === 404);
});

test('알려진 로컬 사진만 존재하는 WebP 파일로 바꾸고 업로드 사진과 원본 설정은 보존한다', async () => {
  for (const display of Object.values(PROPERTY_DISPLAY)) {
    for (const image of propertyImagePaths(display)) {
      assert.ok(existsSync(new URL(`../public${image.src}`, import.meta.url)), image.src);
      assert.ok(existsSync(new URL(`../public${image.webp}`, import.meta.url)), image.webp);
      assert.deepEqual(optimizedPropertyImages(display.slug, [image.src]), [image.webp]);
    }
  }
  const images = ['/images/unwa/gallery-01.jpg', '/images/unwa/new-upload.jpg', 'https://storage.example.com/photo.jpg', '/images/unwa/gallery-01.jpg?custom=1'];
  assert.deepEqual(optimizedPropertyImages('unwa', images), ['/images/unwa/gallery-01.webp', ...images.slice(1)]);
  assert.deepEqual(optimizedPropertyImages('custom-stay', images), images);
  db.property[0].publicInfo.images = images.slice(0, 3);
  const detail = await getPublicBookingProperty('unwadang');
  assert.equal(detail.images[0], '/images/unwa/gallery-01.webp');
  assert.equal(detail.imageUrl, detail.images[0]);
  assert.equal(publicListing(db.property[0] as typeof property).imageUrl, detail.imageUrl);
  assert.deepEqual(db.property[0].publicInfo.images, images.slice(0, 3));
});
