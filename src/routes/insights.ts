import { Router } from "express"
import { param, query, body } from "express-validator"
import { auth } from "@/middleware/auth"
import {
  getTenantReadiness,
  getViewingConflicts,
  generateLease,
  getNeighbourhoodInsights,
} from "@/controllers/insightsController"

const router = Router()

/**
 * GET /api/insights/tenant/:tenantUserId/readiness
 * Compute rent readiness score for a tenant (landlord only)
 */
router.get(
  "/tenant/:tenantUserId/readiness",
  auth,
  param("tenantUserId").isMongoId().withMessage("Invalid tenant user ID"),
  getTenantReadiness
)

/**
 * GET /api/insights/property/:propertyId/conflicts
 * Detect same-day viewing conflicts for a property (landlord only)
 */
router.get(
  "/property/:propertyId/conflicts",
  auth,
  param("propertyId").isMongoId().withMessage("Invalid property ID"),
  getViewingConflicts
)

/**
 * POST /api/insights/lease/generate
 * Generate a lease agreement document
 */
router.post(
  "/lease/generate",
  auth,
  body("propertyId").isMongoId().withMessage("Invalid property ID"),
  body("tenantUserId").isMongoId().withMessage("Invalid tenant user ID"),
  body("startDate").isISO8601().withMessage("startDate must be a valid date"),
  body("endDate").isISO8601().withMessage("endDate must be a valid date"),
  body("rentAmount").isNumeric().withMessage("rentAmount must be a number"),
  generateLease
)

/**
 * GET /api/insights/neighbourhood
 * Fetch nearby amenities from OpenStreetMap
 * Query: ?lat=X&lng=Y  OR  ?address=...
 */
router.get(
  "/neighbourhood",
  auth,
  query("lat").optional().isFloat({ min: -90, max: 90 }).withMessage("lat must be a valid latitude"),
  query("lng").optional().isFloat({ min: -180, max: 180 }).withMessage("lng must be a valid longitude"),
  query("address").optional().isString().trim(),
  getNeighbourhoodInsights
)

export { router as insightsRoutes }
