import type { Request } from 'express';
import { AuditLogModel } from '../../models/auth.models';

export interface AuditInput {
  action: string;
  entityType?: string;
  entityId?: string;
  academicSession?: string;
  details?: unknown;
}

export async function writeAudit(
  actor: { id?: string; name?: string } | undefined,
  input: AuditInput,
  ip?: string,
): Promise<void> {
  try {
    await AuditLogModel.create({
      actor: actor?.id,
      actorName: actor?.name,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      academicSession: input.academicSession,
      details: input.details,
      ip,
    });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}

export function audit(req: Request, input: AuditInput): Promise<void> {
  return writeAudit(req.user ? { id: req.user.id, name: req.user.fullName } : undefined, input, req.ip);
}
