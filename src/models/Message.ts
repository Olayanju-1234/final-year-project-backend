import mongoose, { Schema } from "mongoose";
import type { IMessage } from "@/types";

const messageSchema = new Schema<IMessage>(
  {
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: "Property",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, "Subject cannot exceed 200 characters"],
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    messageType: {
      type: String,
      enum: ["inquiry", "viewing_request", "general", "system"],
      default: "general",
    },
    status: {
      type: String,
      enum: ["sent", "read", "replied"],
      default: "sent",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
messageSchema.index({ fromUserId: 1, createdAt: -1 });
messageSchema.index({ toUserId: 1, createdAt: -1 });
messageSchema.index({ propertyId: 1 });
messageSchema.index({ status: 1 });
messageSchema.index({ messageType: 1 });

// Compound index for conversation queries
messageSchema.index({
  fromUserId: 1,
  toUserId: 1,
  createdAt: -1,
});

export const Message = mongoose.model<IMessage>("Message", messageSchema); 