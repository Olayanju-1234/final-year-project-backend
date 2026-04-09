import mongoose, { Schema, Document, Types } from 'mongoose';

export type AuditAction =
  | 'deposit.created'
  | 'deposit.paid'
  | 'deposit.refund_requested'
  | 'deposit.refunded'
  | 'deposit.auto_refunded'
  | 'deposit.forfeited'
  | 'deposit.paystack_initiated'
  | 'deposit.paystack_confirmed'
  | 'viewing.created'
  | 'viewing.status_changed'
  | 'review.submitted'
  | 'subscription.checkout_created'
  | 'connect.onboarding_started'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.register';

export interface IAuditLog extends Document {
  action: AuditAction;
  actorId: Types.ObjectId;
  actorType: 'tenant' | 'landlord' | 'admin' | 'system';
  targetId?: string;
  targetType?: string;
  metadata: Record<string, any>;
  ip?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorType: {
      type: String,
      enum: ['tenant', 'landlord', 'admin', 'system'],
      required: true,
    },
    targetId: { type: String },
    targetType: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String },
  },
  {
    // Only createdAt — audit logs are never updated
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Prevent any updates to audit log documents at the model level
auditLogSchema.pre('findOneAndUpdate', function () {
  throw new Error('AuditLog documents are immutable');
});
auditLogSchema.pre('updateOne', function () {
  throw new Error('AuditLog documents are immutable');
});
auditLogSchema.pre('updateMany', function () {
  throw new Error('AuditLog documents are immutable');
});

auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, action: 1 });
auditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
