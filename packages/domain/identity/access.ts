import {
  assertOperationalAccess,
  propertyAllowsModule,
  scopedAssignedPropertyIds,
} from '../../../lib/operational-access';
import type { OperationalModule } from '../../../lib/operational-permissions';
import type { UserRole } from '../../../lib/types';
import { readLegacySessionToken, verifyLegacySessionToken, type SessionHeaders } from './legacy-session';
import { normalizeRole } from './roles';

export interface AccessOrganization {
  id: string;
  name: string;
  status: string;
  features: unknown;
  version?: number;
}

export interface AccessProperty {
  id: string;
  organizationId: string | null;
  featureOverrides: unknown;
  featureVersion?: number;
  organization: AccessOrganization | null;
}

export interface AccessUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  organizationId: string | null;
  enabledModules: unknown;
  accessVersion?: number;
  organization: AccessOrganization | null;
  properties: Array<{ propertyId: string; property: AccessProperty }>;
}

export interface IdentityRepository {
  findUser(userId: string): Promise<AccessUser | null>;
  findOrganizationProperties(organizationId: string): Promise<AccessProperty[]>;
}

export interface BackendIdentity {
  session: { userId: string; email: string; expiresAt: number };
  user: AccessUser;
  role: UserRole;
  isAdmin: boolean;
  isBusinessAdmin: boolean;
  organizationId: string | null;
  organizationFeatures: unknown;
  organizationStatus: string | undefined;
}

export interface BackendOperationalScope extends BackendIdentity {
  operationalModule: OperationalModule | null;
  featureModules: OperationalModule[];
  propertyIds: string[] | null;
}

export async function authenticateLegacySession(
  headers: SessionHeaders,
  options: { secret: string | Uint8Array; repository: IdentityRepository; now?: Date; allowBearer?: boolean },
): Promise<BackendIdentity | null> {
  const token = readLegacySessionToken(headers, { allowBearer: options.allowBearer });
  if (!token) return null;
  const claims = await verifyLegacySessionToken(token, options.secret, options.now);
  if (!claims) return null;
  return loadBackendIdentity(claims, options.repository);
}

async function loadBackendIdentity(
  session: BackendIdentity['session'],
  repository: IdentityRepository,
): Promise<BackendIdentity | null> {
  const user = await repository.findUser(session.userId);
  if (!user || user.id !== session.userId || user.status !== 'active') return null;
  const role = normalizeRole(user.role);
  return {
    session: { userId: user.id, email: user.email, expiresAt: session.expiresAt },
    user,
    role,
    isAdmin: role === 'super_admin',
    isBusinessAdmin: role === 'admin',
    organizationId: user.organizationId,
    organizationFeatures: user.organization?.features,
    organizationStatus: user.organization?.status,
  };
}

export async function refreshBackendIdentity(
  previous: BackendIdentity,
  repository: IdentityRepository,
  now: Date = new Date(),
): Promise<BackendIdentity | null> {
  if (!Number.isFinite(previous.session.expiresAt) || previous.session.expiresAt <= now.getTime() / 1000) return null;
  return loadBackendIdentity(previous.session, repository);
}

export async function resolveOperationalScope(
  identity: BackendIdentity,
  repository: IdentityRepository,
  operationalModule: OperationalModule | null,
  requiredFeatures: OperationalModule[] = [],
): Promise<BackendOperationalScope> {
  const featureModules = [...new Set([...(operationalModule ? [operationalModule] : []), ...requiredFeatures])];
  assertOperationalAccess(identity, operationalModule, featureModules);
  let propertyIds: string[] | null;
  if (identity.isAdmin) {
    propertyIds = null;
  } else if (identity.role === 'admin') {
    const properties = identity.organizationId
      ? await repository.findOrganizationProperties(identity.organizationId)
      : [];
    propertyIds = properties
      .filter(property => property.organizationId === identity.organizationId && propertyAllowsModule(property, operationalModule) &&
        featureModules.every(feature => propertyAllowsModule(property, feature)))
      .map(property => property.id);
  } else {
    propertyIds = scopedAssignedPropertyIds(identity.organizationId, identity.user.properties, operationalModule, featureModules);
  }
  return { ...identity, operationalModule, featureModules, propertyIds };
}
