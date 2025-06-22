import rateLimit from "express-rate-limit"
import { logger } from "@/utils/logger"

// General API rate limiter
const createRateLimiter = (windowMs: number, max: number, message: string) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      error: "Too many requests",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn("Rate limit exceeded", {
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        endpoint: req.originalUrl,
      })
      res.status(429).json({
        success: false,
        message,
        error: "Too many requests",
      })
    },
  })
}

export const rateLimiter = {
  // General API rate limiter
  general: createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    100, // requests per window
    "Too many requests from this IP, please try again later.",
  ),

  // Authentication rate limiter (stricter)
  auth: createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    5, // login attempts per window
    "Too many authentication attempts, please try again later.",
  ),

  // Optimization rate limiter (most restrictive)
  optimization: createRateLimiter(
    5 * 60 * 1000, // 5 minutes
    10, // optimization requests per window
    "Too many optimization requests, please try again later.",
  ),

  // Property creation rate limiter
  propertyCreation: createRateLimiter(
    60 * 60 * 1000, // 1 hour
    20, // property creations per hour
    "Too many property creation requests, please try again later.",
  ),
}
