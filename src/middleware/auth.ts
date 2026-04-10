import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { User } from "@/models/User"
import type { ApiResponse } from "@/types"
import { logger } from "@/utils/logger"

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        userType: string
      }
    }
  }
}

export const auth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "")

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      } as ApiResponse)
      return
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    const user = await User.findById(decoded.id).select("-password")

    if (!user) {
      res.status(401).json({
        success: false,
        message: "Invalid token. User not found.",
      } as ApiResponse)
      return
    }

    if (!user.isActive) {
      res.status(401).json({
        success: false,
        message: "Account is deactivated.",
      } as ApiResponse)
      return
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      userType: user.userType,
    }

    next()
  } catch (error) {
    logger.error("Authentication error:", error)
    res.status(401).json({
      success: false,
      message: "Invalid token.",
    } as ApiResponse)
  }
}

export const authorize = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Access denied. Not authenticated.",
      } as ApiResponse)
      return
    }

    if (!roles.includes(req.user.userType)) {
      res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      } as ApiResponse)
      return
    }

    next()
  }
}
