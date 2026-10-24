import { createHash } from 'node:crypto';
import type { BackendIdentity } from './access';

export interface AccessRevisionTotals {
  propertyCount?: number;
  propertyVersions?: number;
  organizationCount?: number;
  organizationVersions?: number;
  organizationUpdatedAt?: string | null;
  propertyDigest?: string;
  organizationDigest?: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function accessRevisionFor(identity: BackendIdentity, totals: AccessRevisionTotals): string {
  const state = {
    userId: identity.user.id,
    role: identity.role,
    status: identity.user.status,
    accessVersion: identity.user.accessVersion,
    enabledModules: identity.user.enabledModules,
    organizationId: identity.organizationId,
    organization: identity.user.organization,
    assignments: identity.user.properties.map(item => ({
      id: item.propertyId,
      organizationId: item.property.organizationId,
      featureVersion: item.property.featureVersion,
      featureOverrides: item.property.featureOverrides,
      organization: item.property.organization,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    totals,
  };
  return createHash('sha256').update(JSON.stringify(canonical(state))).digest('base64url');
}
