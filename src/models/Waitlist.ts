import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IWaitlist extends Document {
  propertyId: Types.ObjectId;
  tenantId: Types.ObjectId;
  notified: boolean;
  notifiedAt?: Date;
  createdAt: Date;
}

const waitlistSchema = new Schema<IWaitlist>(
  {
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notified: { type: Boolean, default: false },
    notifiedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One entry per tenant per property
waitlistSchema.index({ propertyId: 1, tenantId: 1 }, { unique: true });

export const Waitlist = mongoose.model<IWaitlist>('Waitlist', waitlistSchema);
