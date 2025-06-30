import { Router } from "express"
import { body, param, query } from "express-validator"
import { optimizationController } from "@/controllers/optimizationController"
import { auth } from "@/middleware/auth"
import { rateLimiter } from "@/middleware/rateLimiter"

const router = Router()

// Validation middleware for optimization request
const optimizationValidation = [
  body("constraints.budget.min")
    .isNumeric()
    .withMessage("Minimum budget must be a number")
    .isFloat({ min: 0 })
    .withMessage("Minimum budget cannot be negative"),

  body("constraints.budget.max")
    .isNumeric()
    .withMessage("Maximum budget must be a number")
    .isFloat({ min: 0 })
    .withMessage("Maximum budget cannot be negative")
    .custom((value, { req }) => {
      if (value <= req.body.constraints.budget.min) {
        throw new Error("Maximum budget must be greater than minimum budget")
      }
      return true
    }),

  body("constraints.location")
    .isString()
    .withMessage("Location must be a string")
    .isLength({ min: 2, max: 100 })
    .withMessage("Location must be between 2 and 100 characters"),

  body("constraints.amenities").isArray().withMessage("Amenities must be an array").optional(),

  body("constraints.bedrooms").isInt({ min: 1, max: 20 }).withMessage("Bedrooms must be between 1 and 20"),

  body("constraints.bathrooms").isInt({ min: 1, max: 20 }).withMessage("Bathrooms must be between 1 and 20"),

  body("weights").isObject().withMessage("Weights must be an object").optional(),

  body("maxResults").isInt({ min: 1, max: 50 }).withMessage("Max results must be between 1 and 50").optional(),
]

// Routes

/**
 * @route   POST /api/optimization/linear-programming
 * @desc    Run Linear Programming optimization
 * @access  Private
 */
router.post(
  "/linear-programming",
  auth,
  rateLimiter.optimization,
  optimizationValidation,
  optimizationController.runOptimization,
)

/**
 * @route   GET /api/optimization/matches/:tenantId
 * @desc    Get optimized matches for a tenant
 * @access  Private
 */
router.get(
  "/matches/:tenantId",
  auth,
  param("tenantId").isMongoId().withMessage("Invalid tenant ID"),
  query("maxResults").isInt({ min: 1, max: 50 }).optional(),
  optimizationController.getMatchesForTenant,
)

/**
 * @route   GET /api/optimization/landlord-matches/:landlordId
 * @desc    Get optimized matches for a landlord
 * @access  Private
 */
router.get(
  "/landlord-matches/:landlordId",
  auth,
  param("landlordId").isMongoId().withMessage("Invalid landlord ID"),
  optimizationController.getMatchesForLandlord,
)

/**
 * @route   GET /api/optimization/stats
 * @desc    Get optimization statistics
 * @access  Private
 */
router.get("/stats", auth, optimizationController.getOptimizationStats)

/**
 * @route   POST /api/optimization/test
 * @desc    Test optimization algorithm performance
 * @access  Private (Admin only)
 */
router.post(
  "/test",
  auth,
  // TODO: Add admin middleware
  optimizationController.testOptimization,
)

export { router as optimizationRoutes }
