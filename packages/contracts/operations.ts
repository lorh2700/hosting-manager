import { z } from 'zod';
import { OPERATIONAL_MODULES } from '../../lib/operational-permissions';

const moduleSchema = z.enum(OPERATIONAL_MODULES.map(item => item.key), { error: '알 수 없는 기능입니다.' });
const featuresSchema = z.partialRecord(moduleSchema, z.boolean());
const idSchema = z.string().trim().min(1).max(100);
const idsSchema = z.array(idSchema).max(500).transform(value => [...new Set(value)]);
const versionSchema = z.number().int().positive();
export const organizationCreateSchema = z.object({ name: z.string().trim().min(1).max(120), propertyIds: idsSchema.default([]), features: featuresSchema.default({}) }).strict();
export const organizationUpdateSchema = z.object({ version: versionSchema, name: z.string().trim().min(1).max(120).optional(), status: z.enum(['active', 'inactive']).optional(), propertyIds: idsSchema.optional(), features: featuresSchema.optional(), migrateAssignedUsers: z.boolean().optional() }).strict().refine(value => Object.keys(value).some(key => !['version', 'migrateAssignedUsers'].includes(key)), '변경할 항목을 선택해 주세요.');
export const settingsSchema = z.object({
  organizations: z.array(z.object({ id: idSchema, version: versionSchema, features: featuresSchema }).strict()).max(100).default([]),
  properties: z.array(z.object({ id: idSchema, version: versionSchema, organizationId: idSchema.nullable().optional(), featureOverrides: featuresSchema.optional() }).strict().refine(value => value.organizationId !== undefined || value.featureOverrides !== undefined, '변경할 지점 설정이 없습니다.')).max(500).default([]),
}).strict().refine(value => value.organizations.length + value.properties.length > 0, '변경할 설정이 없습니다.');
export const userAccessSchema = z.object({ version: versionSchema, role: z.enum(['super_admin', 'admin', 'manager', 'cleaner']).optional(), status: z.enum(['active', 'suspended', 'pending_invite']).optional(), organizationId: idSchema.nullable().optional(), propertyIds: idsSchema.optional(), enabledModules: z.array(moduleSchema).max(OPERATIONAL_MODULES.length).nullable().optional() }).strict().refine(value => Object.keys(value).some(key => key !== 'version'), '변경할 권한이 없습니다.');
export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict();
export const propertyRequestSchema = z.object({ organizationId: idSchema.optional(), name: z.string().trim().min(1).max(120), note: z.string().trim().max(2000).default('') }).strict();
export const decideRequestSchema = z.object({ version: versionSchema, status: z.enum(['approved', 'rejected']), decisionNote: z.string().trim().max(2000).default('') }).strict();


export const operationsBodySchemas = {
  createOrganization: organizationCreateSchema,
  updateOrganization: organizationUpdateSchema,
  updateSettings: settingsSchema,
  updateUserAccess: userAccessSchema,
  inviteAdministrator: inviteSchema,
  createPropertyRequest: propertyRequestSchema,
  decidePropertyRequest: decideRequestSchema,
} as const;
