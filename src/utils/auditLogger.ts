import { AuditLog, AuditAction } from '@/models/AuditLog';
import { logger } from '@/utils/logger';
import type { Types } from 'mongoose';

interface AuditParams {
  action: AuditAction;
  actorId: Types.ObjectId | string;
  actorType: 'tenant' | 'landlord' | 'admin' | 'system';
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, any>;
  ip?: string;
}

/**
 * Write an append-only audit log entry.
 * Never throws — a logging failure must never break a payment flow.
 */
export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await AuditLog.create({
      action: params.action,
      actorId: params.actorId,
      actorType: params.actorType,
      targetId: params.targetId,
      targetType: params.targetType,
      metadata: params.metadata ?? {},
      ip: params.ip,
    });
  } catch (err: any) {
    // Log the failure but do not propagate — audit logs must be non-blocking
    logger.error('Failed to write audit log', {
      action: params.action,
      actorId: String(params.actorId),
      error: err.message,
    });
  }
}
