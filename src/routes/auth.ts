import { Router } from "express"
import { body } from "express-validator"
import { authController } from "@/controllers/authController"
import { auth } from "@/middleware/auth"
import { rateLimiter } from "@/middleware/rateLimiter"

const router = Router()

// Validation middleware
const registerValidation = [
  body("name").isLength({ min: 2, max: 100 }).withMessage("Name must be between 2 and 100 characters").trim(),

  body("email").isEmail().withMessage("Please provide a valid email").normalizeEmail(),

  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain at least one uppercase letter, one lowercase letter, and one number"),

  body("phone").isMobilePhone("any").withMessage("Please provide a valid phone number"),

  body("userType").isIn(["tenant", "landlord"]).withMessage("User type must be either tenant or landlord"),
]

const loginValidation = [
  body("email").isEmail().withMessage("Please provide a valid email").normalizeEmail(),

  body("password").notEmpty().withMessage("Password is required"),
]

const updateProfileValidation = [
  body("name").optional().isLength({ min: 2, max: 100 }).withMessage("Name must be between 2 and 100 characters").trim(),
  body("phone").optional().isMobilePhone("any").withMessage("Please provide a valid phone number"),
  body("profileImage").optional().isURL().withMessage("Profile image must be a valid URL"),
]

const changePasswordValidation = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("New password must contain at least one uppercase letter, one lowercase letter, and one number"),
]

// Routes

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post("/register", rateLimiter.auth, registerValidation, authController.register)

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post("/login", rateLimiter.auth, loginValidation, authController.login)

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post("/logout", auth, authController.logout)

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get("/me", auth, authController.getProfile)

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put("/profile", auth, updateProfileValidation, authController.updateProfile)

/**
 * @route   PUT /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.put("/change-password", auth, changePasswordValidation, authController.changePassword)

export { router as authRoutes }
