import mongoose from "mongoose"
import { Tenant } from "@/models/Tenant"
import { logger } from "@/utils/logger"

async function fixTenantPreferences() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/rentmatch")
    logger.info("Connected to MongoDB")

    // Find all tenants with empty or missing preferredLocation
    const tenantsToFix = await Tenant.find({
      $or: [
        { "preferences.preferredLocation": { $exists: false } },
        { "preferences.preferredLocation": "" },
        { "preferences.preferredLocation": null }
      ]
    })

    logger.info(`Found ${tenantsToFix.length} tenants with empty or missing preferredLocation`)

    if (tenantsToFix.length === 0) {
      logger.info("No tenants need fixing")
      return
    }

    // Update each tenant
    for (const tenant of tenantsToFix) {
      if (!tenant.preferences) {
        tenant.preferences = {
          budget: { min: 0, max: 1000000 },
          preferredLocation: "Ikeja",
          requiredAmenities: [],
          preferredBedrooms: 1,
          preferredBathrooms: 1,
          maxCommute: 30,
        }
      } else {
        tenant.preferences.preferredLocation = "Ikeja"
      }
      
      await tenant.save()
      logger.info(`Fixed tenant ${tenant._id}`)
    }

    logger.info(`Successfully fixed ${tenantsToFix.length} tenants`)
  } catch (error) {
    logger.error("Error fixing tenant preferences:", error)
  } finally {
    await mongoose.disconnect()
    logger.info("Disconnected from MongoDB")
  }
}

// Run the script
fixTenantPreferences() 