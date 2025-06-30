import { Router } from "express";
import { body, param, query } from "express-validator";
import { tenantController } from "@/controllers/tenantController";
import { auth } from "@/middleware/auth";
import { rateLimiter } from "@/middleware/rateLimiter";

const router = Router();

// Validation middleware for tenant preferences
const preferencesValidation = [
  body("preferences.budget.min")
    .isNumeric()
    .withMessage("Minimum budget must be a number")
    .isFloat({ min: 0 })
    .withMessage("Minimum budget cannot be negative"),

  body("preferences.budget.max")
    .isNumeric()
    .withMessage("Maximum budget must be a number")
    .isFloat({ min: 0 })
    .withMessage("Maximum budget cannot be negative")
    .custom((value, { req }) => {
      if (value <= req.body.preferences.budget.min) {
        throw new Error("Maximum budget must be greater than minimum budget");
      }
      return true;
    }),

  body("preferences.preferredLocation")
    .isString()
    .withMessage("Preferred location must be a string")
    .optional()
    .isLength({ min: 0, max: 100 })
    .withMessage("Preferred location must be between 0 and 100 characters"),

  body("preferences.requiredAmenities")
    .isArray()
    .withMessage("Required amenities must be an array")
    .optional(),

  body("preferences.preferredBedrooms")
    .isInt({ min: 1, max: 10 })
    .withMessage("Preferred bedrooms must be between 1 and 10"),

  body("preferences.preferredBathrooms")
    .isInt({ min: 1, max: 10 })
    .withMessage("Preferred bathrooms must be between 1 and 10"),

  body("preferences.maxCommute")
    .isInt({ min: 5, max: 180 })
    .withMessage("Maximum commute time must be between 5 and 180 minutes")
    .optional(),
];

// Validation middleware for saved property
const savedPropertyValidation = [
  body("propertyId")
    .isMongoId()
    .withMessage("Property ID must be a valid MongoDB ID"),
];

// Routes

/**
 * @route   GET /api/tenants/:id
 * @desc    Get tenant profile by ID
 * @access  Private
 */
router.get(
  "/:id",
  auth,
  param("id").isMongoId().withMessage("Invalid tenant ID"),
  tenantController.getTenantProfile
);

/**
 * @route   PUT /api/tenants/:id
 * @desc    Update tenant profile
 * @access  Private
 */
router.put(
  "/:id",
  auth,
  rateLimiter.general,
  param("id").isMongoId().withMessage("Invalid tenant ID"),
  tenantController.updateTenantProfile
);

/**
 * @route   PUT /api/tenants/:id/preferences
 * @desc    Update tenant preferences
 * @access  Private
 */
router.put(
  "/:id/preferences",
  auth,
  rateLimiter.general,
  param("id").isMongoId().withMessage("Invalid tenant ID"),
  preferencesValidation,
  tenantController.updatePreferences
);

/**
 * @route   GET /api/tenants/:id/saved-properties
 * @desc    Get tenant's saved properties
 * @access  Private
 */
router.get(
  "/:id/saved-properties",
  auth,
  param("id").isMongoId().withMessage("Invalid tenant ID"),
  query("page").isInt({ min: 1 }).optional(),
  query("limit").isInt({ min: 1, max: 50 }).optional(),
  tenantController.getSavedProperties
);

/**
 * @route   POST /api/tenants/:id/saved-properties
 * @desc    Add property to saved properties
 * @access  Private
 */
router.post(
  "/:id/saved-properties",
  auth,
  rateLimiter.general,
  param("id").isMongoId().withMessage("Invalid tenant ID"),
  savedPropertyValidation,
  tenantController.addSavedProperty
);

/**
 * @route   DELETE /api/tenants/:id/saved-properties/:propertyId
 * @desc    Remove property from saved properties
 * @access  Private
 */
router.delete(
  "/:id/saved-properties/:propertyId",
  auth,
  rateLimiter.general,
  param("id").isMongoId().withMessage("Invalid tenant ID"),
  param("propertyId").isMongoId().withMessage("Invalid property ID"),
  tenantController.removeSavedProperty
);

/**
 * @route   GET /api/tenants/:id/search-history
 * @desc    Get tenant's search history
 * @access  Private
 */
router.get(
  "/:id/search-history",
  auth,
  param("id").isMongoId().withMessage("Invalid tenant ID"),
  query("page").isInt({ min: 1 }).optional(),
  query("limit").isInt({ min: 1, max: 50 }).optional(),
  tenantController.getSearchHistory
);

export { router as tenantRoutes }; 