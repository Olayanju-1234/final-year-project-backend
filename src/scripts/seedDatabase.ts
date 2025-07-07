import dotenv from "dotenv"
import { database } from "@/config/database"
import { User } from "@/models/User"
import { Property } from "@/models/Property"
import { Tenant } from "@/models/Tenant"
import { logger } from "@/utils/logger"

dotenv.config()

const sampleUsers = [
  {
    name: "John Doe",
    email: "john.tenant@example.com",
    password: "password123",
    phone: "+234 801 234 5678",
    userType: "tenant",
    isVerified: true,
  },
  {
    name: "Jane Smith",
    email: "jane.landlord@example.com",
    password: "password123",
    phone: "+234 802 345 6789",
    userType: "landlord",
    isVerified: true,
  },
  {
    name: "Mike Johnson",
    email: "mike.tenant@example.com",
    password: "password123",
    phone: "+234 803 456 7890",
    userType: "tenant",
    isVerified: true,
  },
  {
    name: "Sarah Wilson",
    email: "sarah.landlord@example.com",
    password: "password123",
    phone: "+234 804 567 8901",
    userType: "landlord",
    isVerified: true,
  },
]

const sampleProperties = [
  {
    title: "Modern 2-Bedroom Apartment in Victoria Island",
    description:
      "Spacious and well-furnished apartment with modern amenities in the heart of Victoria Island. Perfect for young professionals.",
    location: {
      address: "15 Ahmadu Bello Way",
      city: "Victoria Island",
      state: "Lagos",
      coordinates: {
        latitude: 6.4281,
        longitude: 3.4219,
      },
    },
    rent: 850000,
    bedrooms: 2,
    bathrooms: 2,
    size: 120,
    amenities: ["WiFi", "Parking", "Security", "Generator", "Air Conditioning"],
    images: [
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop",
      "https://images.unsplash.com/photo-1560448204-603b3fc33ddc?w=800&h=600&fit=crop"
    ],
    features: {
      furnished: true,
      petFriendly: false,
      parking: true,
      balcony: true,
    },
    utilities: {
      electricity: true,
      water: true,
      internet: true,
      gas: true,
    },
    status: "available",
  },
  {
    title: "Luxury 3-Bedroom Duplex in Lekki",
    description:
      "Executive duplex with premium finishes and excellent facilities. Located in a serene environment with 24/7 security.",
    location: {
      address: "45 Chevron Drive",
      city: "Lekki",
      state: "Lagos",
      coordinates: {
        latitude: 6.4698,
        longitude: 3.5852,
      },
    },
    rent: 1200000,
    bedrooms: 3,
    bathrooms: 3,
    size: 180,
    amenities: ["WiFi", "Parking", "Security", "Generator", "Swimming Pool", "Gym"],
    images: [
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&h=600&fit=crop",
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&h=600&fit=crop"
    ],
    features: {
      furnished: true,
      petFriendly: true,
      parking: true,
      balcony: true,
    },
    utilities: {
      electricity: true,
      water: true,
      internet: true,
      gas: true,
    },
    status: "available",
  },
  {
    title: "Cozy 1-Bedroom Studio in Ikeja",
    description:
      "Perfect starter home for young professionals. Compact but well-designed with all essential amenities.",
    location: {
      address: "23 Allen Avenue",
      city: "Ikeja",
      state: "Lagos",
      coordinates: {
        latitude: 6.6018,
        longitude: 3.3515,
      },
    },
    rent: 450000,
    bedrooms: 1,
    bathrooms: 1,
    size: 60,
    amenities: ["WiFi", "Security", "Generator"],
    images: [
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop",
      "https://images.unsplash.com/photo-1560448204-603b3fc33ddc?w=800&h=600&fit=crop"
    ],
    features: {
      furnished: false,
      petFriendly: false,
      parking: false,
      balcony: false,
    },
    utilities: {
      electricity: true,
      water: true,
      internet: false,
      gas: false,
    },
    status: "available",
  },
  {
    title: "Spacious 4-Bedroom House in Surulere",
    description: "Family-friendly house with large compound and parking space. Great for families with children.",
    location: {
      address: "67 Bode Thomas Street",
      city: "Surulere",
      state: "Lagos",
      coordinates: {
        latitude: 6.4969,
        longitude: 3.3612,
      },
    },
    rent: 980000,
    bedrooms: 4,
    bathrooms: 3,
    size: 200,
    amenities: ["Parking", "Security", "Generator", "Garden"],
    images: [
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&h=600&fit=crop",
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=600&fit=crop"
    ],
    features: {
      furnished: false,
      petFriendly: true,
      parking: true,
      balcony: false,
    },
    utilities: {
      electricity: true,
      water: true,
      internet: false,
      gas: true,
    },
    status: "available",
  },
  {
    title: "Executive 2-Bedroom Flat in Yaba",
    description: "Modern apartment close to universities and tech hubs. Ideal for students and tech professionals.",
    location: {
      address: "12 Herbert Macaulay Way",
      city: "Yaba",
      state: "Lagos",
      coordinates: {
        latitude: 6.5158,
        longitude: 3.3707,
      },
    },
    rent: 650000,
    bedrooms: 2,
    bathrooms: 2,
    size: 90,
    amenities: ["WiFi", "Security", "Generator", "Study Room"],
    images: [
      "https://images.unsplash.com/photo-1560448204-603b3fc33ddc?w=800&h=600&fit=crop",
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&h=600&fit=crop"
    ],
    features: {
      furnished: true,
      petFriendly: false,
      parking: false,
      balcony: true,
    },
    utilities: {
      electricity: true,
      water: true,
      internet: true,
      gas: false,
    },
    status: "available",
  },
]

const sampleTenantPreferences = [
  {
    budget: { min: 400000, max: 900000 },
    preferredLocation: "Victoria Island",
    requiredAmenities: ["WiFi", "Parking", "Security"],
    preferredBedrooms: 2,
    preferredBathrooms: 2,
    maxCommute: 30,
  },
  {
    budget: { min: 600000, max: 1500000 },
    preferredLocation: "Lekki",
    requiredAmenities: ["WiFi", "Parking", "Security", "Swimming Pool"],
    preferredBedrooms: 3,
    preferredBathrooms: 2,
    maxCommute: 45,
  },
]

async function seedDatabase() {
  try {
    logger.info("Starting database seeding...")

    // Connect to database
    await database.connect()

    // Clear existing data
    await User.deleteMany({})
    await Property.deleteMany({})
    await Tenant.deleteMany({})
    logger.info("Cleared existing data")

    // Create users
    const createdUsers = await User.create(sampleUsers)
    logger.info(`Created ${createdUsers.length} users`)

    // Find landlords and tenants
    const landlords = createdUsers.filter((user) => user.userType === "landlord")
    const tenants = createdUsers.filter((user) => user.userType === "tenant")

    // Create properties (assign to landlords)
    const propertiesWithLandlords = sampleProperties.map((property, index) => ({
      ...property,
      landlordId: landlords[index % landlords.length]._id,
    }))

    const createdProperties = await Property.create(propertiesWithLandlords)
    logger.info(`Created ${createdProperties.length} properties`)

    // Create tenant preferences
    const tenantPreferencesWithIds = sampleTenantPreferences.map((preferences, index) => ({
      userId: tenants[index]._id,
      preferences,
    }))

    const createdTenants = await Tenant.create(tenantPreferencesWithIds)
    logger.info(`Created ${createdTenants.length} tenant profiles`)

    logger.info("✅ Database seeding completed successfully!")

    // Log summary
    logger.info("Seeding Summary:", {
      users: createdUsers.length,
      properties: createdProperties.length,
      tenants: createdTenants.length,
      landlords: landlords.length,
    })

    process.exit(0)
  } catch (error) {
    logger.error("❌ Database seeding failed:", error)
    process.exit(1)
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase()
}

export { seedDatabase }
