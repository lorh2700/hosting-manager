import { prisma } from '@/lib/prisma';
import { auditData, type AuditActor, type AuditInput } from '@/packages/domain/operations/audit';

export { auditData, safeAuditDetails, type AuditActor, type AuditInput } from '@/packages/domain/operations/audit';

export async function writeAuditLog(auth: AuditActor, input: AuditInput, opts: { client?: { auditLog: { create: (args: { data: ReturnType<typeof auditData> }) => Promise<unknown> } }; strict?: boolean } = {}): Promise<void> {
  try {
    await (opts.client ?? prisma).auditLog.create({ data: auditData(auth, input) });
  } catch (error) {
    // A missing/unavailable log table must not turn a completed operation into a retryable failure.
    console.error('[audit] write failed', { action: input.action, error: error instanceof Error ? error.name : 'UnknownError' });
    if (opts.strict) throw error;
  }
}
