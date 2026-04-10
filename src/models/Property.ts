import mongoose, { Schema } from "mongoose"
import type { IProperty } from "@/types"

const propertySchema = new Schema<IProperty>(
  {
    landlordId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: [true, "Property title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      required: [true, "Property description is required"],
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    location: {
      address: {
        type: String,
        required: true,
        trim: true,
      },
      city: {
        type: String,
        required: true,
        trim: true,
      },
      state: {
        type: String,
        required: true,
        trim: true,
      },
      coordinates: {
        latitude: {
          type: Number,
          min: [-90, "Invalid latitude"],
          max: [90, "Invalid latitude"],
        },
        longitude: {
          type: Number,
          min: [-180, "Invalid longitude"],
          max: [180, "Invalid longitude"],
        },
      },
    },
    rent: {
      type: Number,
      required: [true, "Rent amount is required"],
      min: [0, "Rent cannot be negative"],
    },
    bedrooms: {
      type: Number,
      required: [true, "Number of bedrooms is required"],
      min: [1, "Minimum 1 bedroom required"],
      max: [20, "Maximum 20 bedrooms allowed"],
    },
    bathrooms: {
      type: Number,
      required: [true, "Number of bathrooms is required"],
      min: [1, "Minimum 1 bathroom required"],
      max: [20, "Maximum 20 bathrooms allowed"],
    },
    size: {
      type: Number,
      min: [10, "Minimum size is 10 square meters"],
      max: [10000, "Maximum size is 10000 square meters"],
    },
    amenities: [
      {
        type: String,
        trim: true,
      },
    ],
    images: [
      {
        type: String,
        trim: true,
      },
    ],
    status: {
      type: String,
      enum: ["available", "occupied", "maintenance", "pending"],
      default: "available",
    },
    features: {
      furnished: {
        type: Boolean,
        default: false,
      },
      petFriendly: {
        type: Boolean,
        default: false,
      },
      parking: {
        type: Boolean,
        default: false,
      },
      balcony: {
        type: Boolean,
        default: false,
      },
    },
    utilities: {
      electricity: {
        type: Boolean,
        default: true,
      },
      water: {
        type: Boolean,
        default: true,
      },
      internet: {
        type: Boolean,
        default: false,
      },
      gas: {
        type: Boolean,
        default: false,
      },
    },
    views: {
      type: Number,
      default: 0,
    },
    inquiries: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
)

// Indexes for optimization and search
propertySchema.index({ landlordId: 1 })
propertySchema.index({ status: 1 })
propertySchema.index({ rent: 1 })
propertySchema.index({ bedrooms: 1, bathrooms: 1 })
propertySchema.index({ "location.city": 1, "location.state": 1 })
propertySchema.index({ amenities: 1 })
propertySchema.index({ createdAt: -1 })

// Compound index for optimization queries
propertySchema.index({
  status: 1,
  rent: 1,
  bedrooms: 1,
  bathrooms: 1,
  "location.city": 1,
})

// Text index for search
propertySchema.index({
  title: "text",
  description: "text",
  "location.address": "text",
  "location.city": "text",
})

export const Property = mongoose.model<IProperty>("Property", propertySchema)
