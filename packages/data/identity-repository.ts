import type { PrismaClient } from '../../generated/prisma/client';
import { operationalDatabase } from '../../lib/operational-database';
import { fail } from '../../lib/core/errors';
import type { BackendIdentity, IdentityRepository } from '../domain/identity/access';
import { accessRevisionFor } from '../domain/identity/revision';

const MAX_IDENTITY_PROPERTIES = 2_000;
const organizationSelect = { id: true, name: true, status: true, features: true, version: true } as const;
const propertySelect = {
  id: true,
  organizationId: true,
  featureOverrides: true,
  featureVersion: true,
  organization: { select: organizationSelect },
} as const;

export function createIdentityRepository(db: Pick<PrismaClient, 'user' | 'property'>): IdentityRepository {
  return {
    async findUser(userId) {
      const user = await operationalDatabase(() => db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          status: true,
          organizationId: true,
          enabledModules: true,
          accessVersion: true,
          organization: { select: organizationSelect },
          properties: { select: { propertyId: true, property: { select: propertySelect } }, take: MAX_IDENTITY_PROPERTIES + 1 },
        },
      }));
      if (user && user.properties.length > MAX_IDENTITY_PROPERTIES) throw fail(503, '계정에 배정된 숙소가 조회 한도를 초과했습니다.', { accessScopeTooLarge: true });
      return user;
    },
    async findOrganizationProperties(organizationId) {
      const properties = await operationalDatabase(() => db.property.findMany({
        where: { organizationId },
        select: propertySelect,
        orderBy: { id: 'asc' },
        take: MAX_IDENTITY_PROPERTIES + 1,
      }));
      if (properties.length > MAX_IDENTITY_PROPERTIES) throw fail(503, '사업자의 숙소가 조회 한도를 초과했습니다.', { accessScopeTooLarge: true });
      return properties;
    },
  };
}

export function createAccessRevisionReader(db: Pick<PrismaClient, '$queryRaw'>) {
  return async (identity: BackendIdentity): Promise<string> => {
    const isSuper = identity.role === 'super_admin';
    const isBusinessAdmin = identity.role === 'admin';
    // Aggregate in PostgreSQL so property membership changes cannot cancel out like version sums.
    const rows = await operationalDatabase(() => db.$queryRaw<Array<{ propertyDigest: string; organizationDigest: string }>>`
      SELECT
        COALESCE((
          SELECT md5(string_agg(jsonb_build_array(
            p.id, p.organization_id, p.feature_version, p.feature_overrides,
            o.id, o.status, o.version, o.features
          )::text, ',' ORDER BY p.id))
          FROM properties p
          LEFT JOIN organizations o ON o.id = p.organization_id
          WHERE ${isSuper}
            OR (${isBusinessAdmin} AND p.organization_id = ${identity.organizationId})
            OR (${!isSuper && !isBusinessAdmin}
              AND p.organization_id IS NOT DISTINCT FROM ${identity.organizationId}
              AND EXISTS (SELECT 1 FROM user_properties up WHERE up.property_id = p.id AND up.user_id = ${identity.session.userId}))
        ), md5('')) AS "propertyDigest",
        CASE WHEN ${isSuper} THEN COALESCE((
          SELECT md5(string_agg(jsonb_build_array(o.id, o.name, o.status, o.version, o.features)::text, ',' ORDER BY o.id))
          FROM organizations o
        ), md5('')) ELSE '' END AS "organizationDigest"
    `);
    const revision = rows[0];
    if (!revision || typeof revision.propertyDigest !== 'string' || typeof revision.organizationDigest !== 'string') {
      throw fail(503, '현재 사용 권한을 확인하지 못했습니다.');
    }
    return accessRevisionFor(identity, revision);
  };
}
