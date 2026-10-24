import { z } from 'zod';
import type { BackendRoute } from './backend-routes';

export const PEOPLE_EVENT_IMAGE_BYTES = 2 * 1024 * 1024;
export const PEOPLE_EVENT_UPLOAD_BODY_BYTES = 3 * 1024 * 1024;
const id = z.string().trim().min(1).max(100);
const version = z.number().int().positive();
const staffFields = {
  name: z.string().trim().min(1).max(100), phone: z.string().trim().min(9).max(30),
  propertyIds: z.array(id).max(200).refine(ids => new Set(ids).size === ids.length, '중복된 숙소를 제거해 주세요.'),
};
export const createCleanerSchema = z.object({ ...staffFields, organizationId: id.nullable().optional(), loginEnabled: z.boolean(), role: z.enum(['manager', 'cleaner']).default('cleaner') }).strict();
export const updateCleanerSchema = z.object({ version, name: staffFields.name.optional(), phone: staffFields.phone.optional(),
  propertyIds: staffFields.propertyIds.optional(), status: z.enum(['active', 'suspended']).optional(),
}).strict().refine(body => Object.keys(body).length > 1, '변경할 내용을 입력해 주세요.');
export const staffLoginSchema = z.object({ version, enabled: z.boolean() }).strict();
export const staffInviteSchema = z.object({ version, email: z.email().max(200) }).strict();
export const staffScheduleSchema = z.object({ version }).strict();
const image = z.object({ url: z.string().max(2000), alt: z.string().max(200), credit: z.string().max(200), sourceUrl: z.string().max(2000) }).strict();
export const jongnoEventSchema = z.object({
  titleKo: z.string().trim().min(1).max(200), titleEn: z.string().max(200).default(''),
  descriptionKo: z.string().max(10000).default(''), descriptionEn: z.string().max(10000).default(''),
  category: z.enum(['festival', 'exhibition', 'performance', 'palace', 'experience']),
  area: z.enum(['bukchon', 'insadong', 'seochon', 'daehakro', 'other']),
  venue: z.string().max(200).default(''), address: z.string().max(500).default(''),
  startDate: z.string().max(10), endDate: z.string().max(10), timeText: z.string().max(500).default(''),
  excludedWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  excludedDates: z.array(z.string().max(10)).max(100).default([]),
  feeType: z.enum(['free', 'paid', 'unknown']).default('unknown'), feeText: z.string().max(500).default(''),
  bookingRequired: z.boolean().default(false), officialUrl: z.string().max(2000).default(''),
  bookingUrl: z.string().max(2000).default(''), mapUrl: z.string().max(2000).default(''), languageText: z.string().max(300).default(''),
  images: z.array(image).max(6).default([]), status: z.enum(['draft', 'published', 'cancelled']).default('draft'),
  verifiedAt: z.string().max(40).nullable().optional(),
}).strict();
export const updateJongnoEventSchema = jongnoEventSchema.extend({ version });
export const archiveJongnoEventSchema = z.object({ version }).strict();
export const uploadJongnoImageSchema = z.object({ mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().min(4).max(Math.ceil(PEOPLE_EVENT_IMAGE_BYTES / 3) * 4),
}).strict();

export const peopleEventBodySchemas = {
  createCleaner: createCleanerSchema, updateCleaner: updateCleanerSchema, configureStaffLogin: staffLoginSchema,
  inviteStaff: staffInviteSchema, rotateStaffSchedule: staffScheduleSchema,
  createJongnoEvent: jongnoEventSchema, updateJongnoEvent: updateJongnoEventSchema,
  archiveJongnoEvent: archiveJongnoEventSchema, uploadJongnoImage: uploadJongnoImageSchema,
};
export const PEOPLE_EVENT_ROUTES: readonly BackendRoute[] = [
  { id: 'staffDetail', method: 'GET', path: 'staff/:id', module: 'staff', summary: '범위 내 청소 인력 상세' },
  { id: 'createCleaner', method: 'POST', path: 'staff', module: 'staff', mutation: true, status: 201, summary: '청소 인력 등록' },
  { id: 'updateCleaner', method: 'PATCH', path: 'staff/:id', module: 'staff', mutation: true, summary: '청소 인력 정보·배정·퇴사·복원' },
  { id: 'configureStaffLogin', method: 'POST', path: 'staff/:id/login', module: 'staff', mutation: true, summary: '청소 인력 로그인 사용·임시 비밀번호 발급' },
  { id: 'inviteStaff', method: 'POST', path: 'staff/:id/invitations', module: 'staff', mutation: true, status: 201, summary: '청소 인력 가입 초대 링크' },
  { id: 'rotateStaffSchedule', method: 'POST', path: 'staff/:id/schedule-link', module: 'staff', mutation: true, summary: '개인 일정 링크 재발급' },
  { id: 'jongnoEvents', method: 'GET', path: 'jongno-events', module: null, superOnly: true, summary: '종로 행사 목록' },
  { id: 'jongnoEventDetail', method: 'GET', path: 'jongno-events/:id', module: null, superOnly: true, summary: '종로 행사 상세' },
  { id: 'createJongnoEvent', method: 'POST', path: 'jongno-events', module: null, superOnly: true, mutation: true, status: 201, summary: '종로 행사 등록' },
  { id: 'updateJongnoEvent', method: 'PATCH', path: 'jongno-events/:id', module: null, superOnly: true, mutation: true, summary: '종로 행사 수정·공개' },
  { id: 'archiveJongnoEvent', method: 'POST', path: 'jongno-events/:id/archive', module: null, superOnly: true, mutation: true, summary: '종로 행사 비공개 보관' },
  { id: 'uploadJongnoImage', method: 'POST', path: 'jongno-events/images', module: null, superOnly: true, mutation: true, status: 201, summary: '종로 행사 사진 업로드' },
];
