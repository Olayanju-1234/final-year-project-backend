import { Router } from "express"
import { body, param } from "express-validator"
import { propertyController } from "@/controllers/propertyController"
import { auth, authorize } from "@/middleware/auth"
import { rateLimiter } from "@/middleware/rateLimiter"
import { uploadMultiple, handleUploadError } from "@/middleware/upload"

const router = Router()

// Validation middleware
const propertyValidation = [
  body("title").isLength({ min: 5, max: 200 }).withMessage("Title must be between 5 and 200 characters").trim(),

  body("description")
    .isLength({ min: 20, max: 2000 })
    .withMessage("Description must be between 20 and 2000 characters")
    .trim(),

  body("location.address").notEmpty().withMessage("Address is required").trim(),

  body("location.city").notEmpty().withMessage("City is required").trim(),

  body("location.state").notEmpty().withMessage("State is required").trim(),

  body("rent")
    .isNumeric()
    .withMessage("Rent must be a number")
    .isFloat({ min: 0 })
    .withMessage("Rent cannot be negative"),

  body("bedrooms").isInt({ min: 1, max: 20 }).withMessage("Bedrooms must be between 1 and 20"),

  body("bathrooms").isInt({ min: 1, max: 20 }).withMessage("Bathrooms must be between 1 and 20"),

  body("size")
    .optional()
    .isNumeric()
    .withMessage("Size must be a number")
    .isFloat({ min: 10, max: 10000 })
    .withMessage("Size must be between 10 and 10000 square meters"),

  body("amenities").isArray().withMessage("Amenities must be an array"),

  // Custom validation for features and utilities from form data
  (req: any, res: any, next: any) => {
    console.log("Raw request body:", req.body) // Debug log
    
    // Parse features from form data
    const features = {
      furnished: req.body['features.furnished'] === 'true',
      petFriendly: req.body['features.petFriendly'] === 'true',
      parking: req.body['features.parking'] === 'true',
      balcony: req.body['features.balcony'] === 'true',
    }
    
    // Parse utilities from form data
    const utilities = {
      electricity: req.body['utilities.electricity'] === 'true',
      water: req.body['utilities.water'] === 'true',
      internet: req.body['utilities.internet'] === 'true',
      gas: req.body['utilities.gas'] === 'true',
    }
    
    // Parse amenities array from form data
    // When multiple fields have the same name, they come as an array
    let amenities = []
    if (Array.isArray(req.body.amenities)) {
      amenities = req.body.amenities
    } else if (req.body.amenities) {
      amenities = [req.body.amenities]
    }
    
    console.log("Parsed features:", features) // Debug log
    console.log("Parsed utilities:", utilities) // Debug log
    console.log("Parsed amenities:", amenities) // Debug log
    
    // Add parsed objects to request body
    req.body.features = features
    req.body.utilities = utilities
    req.body.amenities = amenities
    
    next()
  },

  body("features").isObject().withMessage("Features must be an object"),

  body("utilities").isObject().withMessage("Utilities must be an object"),
]

// Routes

/**
 * @route   GET /api/properties
 * @desc    Get all properties with filtering
 * @access  Public
 */
router.get("/", propertyController.getProperties)

/**
 * @route   GET /api/properties/random
 * @desc    Get random properties for landing page
 * @access  Public
 */
router.get("/random", propertyController.getRandomProperties)

/**
 * @route   GET /api/properties/stats
 * @desc    Get aggregated property statistics for landing page
 * @access  Public
 */
router.get("/stats", propertyController.getPropertyStats)

/**
 * @route   GET /api/properties/:id
 * @desc    Get property by ID
 * @access  Public
 */
router.get("/:id", param("id").isMongoId().withMessage("Invalid property ID"), propertyController.getPropertyById)

/**
 * @route   POST /api/properties
 * @desc    Create new property with images
 * @access  Private (Landlords only)
 */
router.post(
  "/",
  auth,
  authorize("landlord"),
  rateLimiter.propertyCreation,
  uploadMultiple as any,
  handleUploadError,
  propertyValidation,
  propertyController.createProperty,
)

/**
 * @route   PUT /api/properties/:id
 * @desc    Update property
 * @access  Private (Property owner only)
 */
router.put(
  "/:id",
  auth,
  authorize("landlord"),
  param("id").isMongoId().withMessage("Invalid property ID"),
  uploadMultiple as any,
  handleUploadError,
  propertyValidation,
  propertyController.updateProperty,
)

/**
 * @route   DELETE /api/properties/:id
 * @desc    Delete property
 * @access  Private (Property owner only)
 */
router.delete(
  "/:id",
  auth,
  authorize("landlord"),
  param("id").isMongoId().withMessage("Invalid property ID"),
  propertyController.deleteProperty,
)

/**
 * @route   GET /api/properties/landlord/:landlordId
 * @desc    Get properties by landlord
 * @access  Public
 */
router.get(
  "/landlord/:landlordId",
  param("landlordId").isMongoId().withMessage("Invalid landlord ID"),
  propertyController.getPropertiesByLandlord,
)

/**
 * @route   DELETE /api/properties/:id/images/:imageIndex
 * @desc    Delete an image from a property
 * @access  Private (Property owner only)
 */
router.delete(
  "/:id/images/:imageIndex",
  auth,
  authorize("landlord"),
  param("id").isMongoId().withMessage("Invalid property ID"),
  param("imageIndex").isInt({ min: 0 }).withMessage("Invalid image index"),
  propertyController.deleteImage,
)

export { router as propertyRoutes }
