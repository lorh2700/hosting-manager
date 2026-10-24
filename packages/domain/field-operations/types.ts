import type { Prisma } from '../../../generated/prisma/client';
import type { BackendIdentity } from '../identity/access';

export type FieldActor = BackendIdentity & { requestId?: string };
export type FieldDatabase = Pick<Prisma.TransactionClient, 'property' | 'inventorySnapshot' | 'inventoryCountRecord' | 'laundryBatch' | 'supplyRequest' | 'cleaning' | 'event' | 'booking' | 'auditLog'>;
export type FieldTransaction = <T>(execute: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
export interface FieldQuery { propertyId?: string | null; cursor?: string | null; status?: string | null; month?: string | null }
export interface CountItem { name: string; quantity: number; checkedAt?: string; checkedBy?: string }
export interface LaundryItem { name: string; sent: number; received: number; damaged: number; rewash: number }
export interface FieldHistory { at: string; actorId: string; actor: string; action: string; note?: string; items?: unknown; before?: unknown }
export interface SettlementRow { cleanerId: string; cleanerName: string; propertyId: string; propertyName: string; done: number; pending: number; total: number }
