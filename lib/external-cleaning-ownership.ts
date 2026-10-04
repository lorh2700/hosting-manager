import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import type { ApiClient } from './api-auth';

type ClientReader = Pick<Prisma.TransactionClient, 'apiClient'>;
export function deriveExternalSource(client: Pick<ApiClient, 'id'>): string {
  return `api-client:${client.id}`;
}
export function legacyExternalSource(client: Pick<ApiClient, 'name'>): string {
  return client.name.toLowerCase().split(/\s+/)[0] || 'partner';
}

/** Legacy labels have no client identity: accept only an unambiguous existing owner. */
export async function ownsExternalCleaning(client: ApiClient,
  row: { propertyId: string; externalSource: string | null }, reader: ClientReader = prisma): Promise<boolean> {
  if (!client.propertyIds.includes(row.propertyId)) return false;
  if (row.externalSource === deriveExternalSource(client)) return true;
  if (!row.externalSource || row.externalSource !== legacyExternalSource(client)) return false;
  const candidates = await reader.apiClient.findMany({ select: { id: true, name: true, propertyIds: true } });
  // Include revoked keys: revocation does not transfer their historical records.
  const owners = candidates.filter(candidate => legacyExternalSource(candidate) === row.externalSource
    && (!candidate.propertyIds.length || candidate.propertyIds.includes(row.propertyId)));
  return owners.length === 1 && owners[0].id === client.id;
}
