import mongoose, { Schema } from "mongoose";
import type { IViewing } from "@/types";

const viewingSchema = new Schema<IViewing>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    landlordId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },
    requestedDate: {
      type: Date,
      required: true,
    },
    requestedTime: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed"],
      default: "pending",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
viewingSchema.index({ tenantId: 1, createdAt: -1 });
viewingSchema.index({ landlordId: 1, createdAt: -1 });
viewingSchema.index({ propertyId: 1 });
viewingSchema.index({ status: 1 });
viewingSchema.index({ requestedDate: 1 });

// Compound index for viewing requests
viewingSchema.index({
  propertyId: 1,
  requestedDate: 1,
  status: 1,
});

// Validation for requested date (must be in the future)
viewingSchema.pre("save", function (next) {
  if (this.requestedDate <= new Date()) {
    return next(new Error("Requested date must be in the future"));
  }
  next();
});

export const Viewing = mongoose.model<IViewing>("Viewing", viewingSchema); 