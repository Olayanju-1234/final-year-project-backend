import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IViewingPayment extends Document {
  viewingId: Types.ObjectId;
  propertyId: Types.ObjectId;
  tenantId: Types.ObjectId;
  landlordId: Types.ObjectId;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'refunded' | 'forfeited';
  stripe_session_id: string;
  stripe_payment_intent_id?: string;
  stripe_refund_id?: string;
  refund_reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const viewingPaymentSchema = new Schema<IViewingPayment>(
  {
    viewingId: {
      type: Schema.Types.ObjectId,
      ref: 'Viewing',
      required: true,
      unique: true, // one payment per viewing
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    landlordId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: 'gbp',
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'forfeited'],
      default: 'pending',
    },
    stripe_session_id: {
      type: String,
      required: true,
      unique: true,
    },
    stripe_payment_intent_id: {
      type: String,
      index: { sparse: true },
    },
    stripe_refund_id: {
      type: String,
    },
    refund_reason: {
      type: String,
    },
  },
  { timestamps: true },
);

viewingPaymentSchema.index({ tenantId: 1, createdAt: -1 });
viewingPaymentSchema.index({ landlordId: 1, createdAt: -1 });
viewingPaymentSchema.index({ status: 1 });

export const ViewingPayment = mongoose.model<IViewingPayment>(
  'ViewingPayment',
  viewingPaymentSchema,
);
