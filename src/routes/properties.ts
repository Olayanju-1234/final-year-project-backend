import { Router } from "express"
import { body, param } from "express-validator"
import { propertyController } from "@/controllers/propertyController"
import { auth, authorize } from "@/middleware/auth"
import { rateLimiter } from "@/middleware/rateLimiter"

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
 * @route   GET /api/properties/:id
 * @desc    Get property by ID
 * @access  Public
 */
router.get("/:id", param("id").isMongoId().withMessage("Invalid property ID"), propertyController.getPropertyById)

/**
 * @route   POST /api/properties
 * @desc    Create new property
 * @access  Private (Landlords only)
 */
router.post(
  "/",
  auth,
  authorize("landlord"),
  rateLimiter.propertyCreation,
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

export { router as propertyRoutes }
