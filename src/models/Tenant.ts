import mongoose, { Schema } from "mongoose"
import type { ITenant } from "@/types"

const tenantSchema = new Schema<ITenant>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    preferences: {
      budget: {
        min: {
          type: Number,
          required: true,
          min: [0, "Minimum budget cannot be negative"],
        },
        max: {
          type: Number,
          required: true,
          min: [0, "Maximum budget cannot be negative"],
        },
      },
      preferredLocation: {
        type: String,
        required: true,
        trim: true,
      },
      requiredAmenities: [
        {
          type: String,
          trim: true,
        },
      ],
      preferredBedrooms: {
        type: Number,
        required: true,
        min: [1, "Minimum 1 bedroom required"],
        max: [10, "Maximum 10 bedrooms allowed"],
      },
      preferredBathrooms: {
        type: Number,
        required: true,
        min: [1, "Minimum 1 bathroom required"],
        max: [10, "Maximum 10 bathrooms allowed"],
      },
      maxCommute: {
        type: Number,
        min: [5, "Minimum commute time is 5 minutes"],
        max: [180, "Maximum commute time is 180 minutes"],
      },
      features: {
        furnished: { type: Boolean, default: false },
        petFriendly: { type: Boolean, default: false },
        parking: { type: Boolean, default: false },
        balcony: { type: Boolean, default: false },
      },
      utilities: {
        electricity: { type: Boolean, default: false },
        water: { type: Boolean, default: false },
        internet: { type: Boolean, default: false },
        gas: { type: Boolean, default: false },
      },
    },
    searchHistory: [
      {
        type: Schema.Types.ObjectId,
        ref: "Property",
      },
    ],
    savedProperties: [
      {
        type: Schema.Types.ObjectId,
        ref: "Property",
      },
    ],
  },
  {
    timestamps: true,
  },
)

// Indexes for optimization queries
// tenantSchema.index({ userId: 1 })
tenantSchema.index({ "preferences.preferredLocation": 1 })
tenantSchema.index({ "preferences.budget.min": 1, "preferences.budget.max": 1 })

// Validation for budget range
tenantSchema.pre("save", function (next) {
  if (this.preferences.budget.min >= this.preferences.budget.max) {
    return next(new Error("Maximum budget must be greater than minimum budget"))
  }
  next()
})

export const Tenant = mongoose.model<ITenant>("Tenant", tenantSchema)
