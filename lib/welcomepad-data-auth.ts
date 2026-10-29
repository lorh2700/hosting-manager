import { timingSafeEqual } from 'node:crypto';
import { getSessionWithUser } from '@/lib/auth';
import { currentDeviceStay, requireStayDevice, throttleStayAttempt } from './guest-stay-store';
import { fail } from './core/errors';
import { findPadProperty, type PadActor, type WelcomepadOperation } from './welcomepad-data';

const internalOperations = new Set(['properties.list', 'weather.update', 'events.create', 'threads.list', 'threads.close', 'devices.list']);
const deviceOperations = new Set(['config.get', 'cleaning.set', 'weather.get', 'events.create', 'threads.active', 'threads.current', 'messages.list', 'messages.send', 'messages.read']);

export function requireWelcomepadBridge(req: Request) {
  const expected = process.env.WELCOMEPAD_API_KEY;
  const supplied = req.headers.get('x-api-key');
  if (!expected) throw fail(503, '패드 연결이 설정되지 않았습니다.');
  if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw fail(401, 'Unauthorized');
}

export async function authorizeWelcomepadOperation(req: Request, input: WelcomepadOperation): Promise<PadActor> {
  requireWelcomepadBridge(req);
  if (req.headers.get('x-welcomepad-internal') === '1') {
    if (!internalOperations.has(input.operation) || req.headers.has('origin') || req.headers.has('cookie') || req.headers.has('authorization')) throw fail(403, '서버 내부 작업만 허용됩니다.');
    return { kind: 'service' };
  }
  if (req.headers.get('authorization')?.startsWith('Bearer gst_device_')) {
    if (!deviceOperations.has(input.operation) || !('propertyKey' in input)) throw fail(403, '이 패드에서 사용할 수 없는 기능입니다.');
    if ((input.operation === 'messages.send' && input.data.sender !== 'guest') || (input.operation === 'messages.read' && input.data.reader !== 'guest')) throw fail(403, '권한이 없습니다.');
    const device = await requireStayDevice(req);
    const property = await findPadProperty(input.propertyKey);
    if (!property || property.id !== device.propertyId) throw fail(403, '이 패드의 숙소가 아닙니다.');
    await throttleStayAttempt(req, `pad-data:${device.id}`, 180, 1);
    if (input.operation === 'threads.active' || input.operation === 'threads.current' || input.operation.startsWith('messages.')) {
      const stay = await currentDeviceStay(device.propertyId);
      if (!stay && input.operation === 'threads.current') return { kind: 'device', propertyId: device.propertyId };
      if (!stay) throw fail(409, '현재 투숙 중인 예약이 없습니다.');
      return { kind: 'device', propertyId: device.propertyId, stay: { guestName: stay.guestName, checkIn: stay.checkIn, checkOut: stay.checkOut } };
    }
    return { kind: 'device', propertyId: device.propertyId };
  }
  if (['weather.update', 'threads.close', 'devices.list', 'threads.active'].includes(input.operation)) throw fail(403, '허용되지 않은 작업입니다.');
  if ((input.operation === 'messages.send' && input.data.sender !== 'host') || (input.operation === 'messages.read' && input.data.reader !== 'host')) throw fail(403, '권한이 없습니다.');
  const path = input.operation === 'cleaning.set' ? '/api/cleanings'
    : input.operation.startsWith('messages.') || ['threads.list', 'threads.current'].includes(input.operation) ? '/api/welcomepad-chat/messages'
    : input.operation === 'devices.upsert' ? '/api/guest-stays' : '/api/properties';
  const auth = await getSessionWithUser(new Request(new URL(path, req.url), { method: 'GET', headers: req.headers }));
  if (!auth) throw fail(401, '로그인이 필요합니다.');
  if (auth.role === 'cleaner' && input.operation !== 'cleaning.set') throw fail(403, '권한이 없습니다.');
  return { kind: 'staff', userId: auth.session.userId, propertyIds: auth.propertyIds };
}
