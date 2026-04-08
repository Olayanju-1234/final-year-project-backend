import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IReview extends Document {
  tenantId: Types.ObjectId;
  propertyId: Types.ObjectId;
  viewingId: Types.ObjectId;
  rating: number;
  comment?: string;
  createdAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    viewingId: {
      type: Schema.Types.ObjectId,
      ref: 'Viewing',
      required: true,
      unique: true, // one review per viewing — enforced at DB level
    },
    rating: {
      type: Number,
      required: true,
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5'],
    },
    comment: {
      type: String,
      maxlength: [1000, 'Comment cannot exceed 1000 characters'],
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

reviewSchema.index({ propertyId: 1, createdAt: -1 });
reviewSchema.index({ tenantId: 1, createdAt: -1 });

export const Review = mongoose.model<IReview>('Review', reviewSchema);
