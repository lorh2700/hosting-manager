import { prisma } from '@/lib/prisma';

export interface AuditActor {
  session: { userId: string };
  user: { displayName?: string | null; email?: string; organizationId?: string | null };
}
export interface AuditInput {
  action: string;
  module?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  propertyId?: string | null;
  organizationId?: string | null;
  summary: string;
  outcome?: 'success' | 'denied' | 'failed';
  requestId?: string | null;
  details?: Record<string, unknown>;
}

/** Never copy a request body or headers: credentials and guest content must stay out of the activity feed. */
export function safeAuditDetails(value?: Record<string, unknown>): Record<string, string | number | string[]> {
  const safe: Record<string, string | number | string[]> = {};
  if (!value) return safe;
  for (const key of ['method', 'path', 'status']) {
    const item = value[key];
    if (typeof item === 'number' && Number.isFinite(item)) safe[key] = item;
    else if (typeof item === 'string') safe[key] = (key === 'path'
      ? item.split(/[?#]/)[0].replace(/(\/api\/invitations\/)[^/]+/, '$1[token]')
      : item).slice(0, 200);
  }
  if (Array.isArray(value.changedFields)) safe.changedFields = value.changedFields.filter((item): item is string => typeof item === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(item) && !/password|token|secret|credential|authorization|cookie/i.test(item)).slice(0, 30);
  return safe;
}

export function auditData(auth: AuditActor, input: AuditInput) {
  return {
    actorId: auth.session.userId,
    actorName: (auth.user.displayName || auth.user.email || '사용자').slice(0, 100),
    action: input.action.slice(0, 100),
    module: input.module ?? null,
    targetType: input.targetType?.slice(0, 80) ?? null,
    targetId: input.targetId?.slice(0, 150) ?? null,
    propertyId: input.propertyId ?? null,
    organizationId: input.organizationId !== undefined ? input.organizationId : auth.user.organizationId ?? null,
    summary: input.summary.slice(0, 300),
    outcome: input.outcome ?? 'success',
    requestId: input.requestId?.slice(0, 100) ?? null,
    details: safeAuditDetails(input.details),
  };
}

export async function writeAuditLog(auth: AuditActor, input: AuditInput, opts: { client?: { auditLog: { create: (args: { data: ReturnType<typeof auditData> }) => Promise<unknown> } }; strict?: boolean } = {}): Promise<void> {
  try {
    await (opts.client ?? prisma).auditLog.create({ data: auditData(auth, input) });
  } catch (error) {
    // A missing/unavailable log table must not turn a completed operation into a retryable failure.
    console.error('[audit] write failed', { action: input.action, error: error instanceof Error ? error.name : 'UnknownError' });
    if (opts.strict) throw error;
  }
}
