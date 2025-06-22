import type { Request, Response } from "express"
import jwt from "jsonwebtoken"
import { validationResult } from "express-validator"
import { User } from "@/models/User"
import { Tenant } from "@/models/Tenant"
import type { ApiResponse, LoginRequest, RegisterRequest } from "@/types"
import { logger } from "@/utils/logger"

export class AuthController {
  /**
   * Register a new user
   * POST /api/auth/register
   */
  public async register(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          error: errors.array().map(e => e.msg).join(", "),
        } as ApiResponse)
        return
      }

      const { name, email, password, phone, userType, preferences }: RegisterRequest = req.body

      // Check if user already exists
      const existingUser = await User.findOne({ email })
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: "User already exists with this email",
        } as ApiResponse)
        return
      }

      // Create user
      const user = new User({
        name,
        email,
        password,
        phone,
        userType,
      })

      await user.save()

      // Create tenant profile if user is a tenant
      if (userType === "tenant" && preferences) {
        const tenant = new Tenant({
          userId: user._id,
          preferences: {
            budget: preferences.budget || { min: 0, max: 1000000 },
            preferredLocation: preferences.preferredLocation || "",
            requiredAmenities: preferences.requiredAmenities || [],
            preferredBedrooms: preferences.preferredBedrooms || 1,
            preferredBathrooms: preferences.preferredBathrooms || 1,
            maxCommute: preferences.maxCommute,
          },
        })

        await tenant.save()
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, email: user.email, userType: user.userType },
        process.env.JWT_SECRET || "default_secret",
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
      )

      logger.info("User registered successfully", {
        userId: user._id,
        email: user.email,
        userType: user.userType,
      })

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            userType: user.userType,
            isVerified: user.isVerified,
          },
        },
      } as ApiResponse)
    } catch (error) {
      logger.error("Registration failed", error)
      res.status(500).json({
        success: false,
        message: "Registration failed",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse)
    }
  }

  /**
   * Login user
   * POST /api/auth/login
   */
  public async login(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          error: errors.array().map(e => e.msg).join(", "),
        } as ApiResponse)
        return
      }

      const { email, password }: LoginRequest = req.body

      // Find user and include password for comparison
      const user = await User.findOne({ email }).select("+password")
      if (!user) {
        res.status(401).json({
          success: false,
          message: "Invalid email or password",
        } as ApiResponse)
        return
      }

      // Check if user is active
      if (!user.isActive) {
        res.status(401).json({
          success: false,
          message: "Account is deactivated",
        } as ApiResponse)
        return
      }

      // Compare password
      const isPasswordValid = await user.comparePassword(password)
      if (!isPasswordValid) {
        res.status(401).json({
          success: false,
          message: "Invalid email or password",
        } as ApiResponse)
        return
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, email: user.email, userType: user.userType },
        process.env.JWT_SECRET || "default_secret",
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
      )

      logger.info("User logged in successfully", {
        userId: user._id,
        email: user.email,
        userType: user.userType,
      })

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            userType: user.userType,
            isVerified: user.isVerified,
          },
        },
      } as ApiResponse)
    } catch (error) {
      logger.error("Login failed", error)
      res.status(500).json({
        success: false,
        message: "Login failed",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse)
    }
  }

  /**
   * Logout user
   * POST /api/auth/logout
   */
  public async logout(req: Request, res: Response): Promise<void> {
    try {
      // In a production app, you might want to blacklist the token
      // For now, we'll just return a success response

      logger.info("User logged out", {
        userId: req.user?.id,
      })

      res.status(200).json({
        success: true,
        message: "Logout successful",
      } as ApiResponse)
    } catch (error) {
      logger.error("Logout failed", error)
      res.status(500).json({
        success: false,
        message: "Logout failed",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse)
    }
  }

  /**
   * Get current user profile
   * GET /api/auth/me
   */
  public async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const user = await User.findById(req.user!.id)
      if (!user) {
        res.status(404).json({
          success: false,
          message: "User not found",
        } as ApiResponse)
        return
      }

      const profile: any = {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
      }

      // If user is a tenant, include preferences
      if (user.userType === "tenant") {
        const tenant = await Tenant.findOne({ userId: user._id })
        if (tenant) {
          profile.preferences = tenant.preferences
          profile.savedProperties = tenant.savedProperties
        }
      }

      res.status(200).json({
        success: true,
        message: "Profile retrieved successfully",
        data: profile,
      } as ApiResponse)
    } catch (error) {
      logger.error("Failed to get profile", error)
      res.status(500).json({
        success: false,
        message: "Failed to retrieve profile",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse)
    }
  }
}

export const authController = new AuthController()
