import mongoose, { Schema, Document, Types } from 'mongoose';

export type PaymentProvider = 'stripe' | 'paystack';
export type PaymentStatus = 'pending' | 'paid' | 'refund_requested' | 'refunded' | 'forfeited';

export interface IViewingPayment extends Document {
  viewingId: Types.ObjectId;
  propertyId: Types.ObjectId;
  tenantId: Types.ObjectId;
  landlordId: Types.ObjectId;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  // Stripe fields
  stripe_session_id?: string;
  stripe_payment_intent_id?: string;
  stripe_refund_id?: string;
  // Paystack fields
  paystack_reference?: string;
  paystack_transaction_id?: string;
  // Timestamps for financial audit
  paid_at?: Date;
  refunded_at?: Date;
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
      unique: true, // one payment record per viewing
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
      default: 'ngn',
    },
    provider: {
      type: String,
      enum: ['stripe', 'paystack'],
      required: true,
      default: 'stripe',
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'refund_requested', 'refunded', 'forfeited'],
      default: 'pending',
    },
    // Stripe
    stripe_session_id: { type: String, sparse: true },
    stripe_payment_intent_id: { type: String, sparse: true },
    stripe_refund_id: { type: String, sparse: true },
    // Paystack
    paystack_reference: { type: String, sparse: true, index: true },
    paystack_transaction_id: { type: String, sparse: true },
    // Financial timestamps
    paid_at: { type: Date },
    refunded_at: { type: Date },
    refund_reason: { type: String },
  },
  { timestamps: true },
);

viewingPaymentSchema.index({ tenantId: 1, createdAt: -1 });
viewingPaymentSchema.index({ landlordId: 1, createdAt: -1 });
viewingPaymentSchema.index({ status: 1 });
viewingPaymentSchema.index({ stripe_session_id: 1 }, { sparse: true });

export const ViewingPayment = mongoose.model<IViewingPayment>(
  'ViewingPayment',
  viewingPaymentSchema,
);
