import { Router } from "express";
import { body, param, query } from "express-validator";
import { communicationController } from "@/controllers/communicationController";
import { auth } from "@/middleware/auth";
import { rateLimiter } from "@/middleware/rateLimiter";

const router = Router();

// Validation middleware for sending messages
const messageValidation = [
  body("toUserId")
    .isMongoId()
    .withMessage("Recipient ID must be a valid MongoDB ID"),

  body("propertyId")
    .isMongoId()
    .withMessage("Property ID must be a valid MongoDB ID")
    .optional(),

  body("subject")
    .isString()
    .withMessage("Subject must be a string")
    .isLength({ min: 1, max: 200 })
    .withMessage("Subject must be between 1 and 200 characters"),

  body("message")
    .isString()
    .withMessage("Message must be a string")
    .isLength({ min: 1, max: 2000 })
    .withMessage("Message must be between 1 and 2000 characters"),

  body("messageType")
    .isIn(["inquiry", "viewing_request", "general", "system"])
    .withMessage("Message type must be one of: inquiry, viewing_request, general, system")
    .optional(),
];

// Validation middleware for viewing requests
const viewingValidation = [
  body("propertyId")
    .isMongoId()
    .withMessage("Property ID must be a valid MongoDB ID"),

  body("requestedDate")
    .isISO8601()
    .withMessage("Requested date must be a valid date")
    .custom((value) => {
      const date = new Date(value);
      if (date <= new Date()) {
        throw new Error("Requested date must be in the future");
      }
      return true;
    }),

  body("requestedTime")
    .isString()
    .withMessage("Requested time must be a string")
    .isLength({ min: 1, max: 50 })
    .withMessage("Requested time must be between 1 and 50 characters"),

  body("notes")
    .isString()
    .withMessage("Notes must be a string")
    .isLength({ max: 500 })
    .withMessage("Notes cannot exceed 500 characters")
    .optional(),
];

// Validation middleware for updating viewing status
const viewingStatusValidation = [
  body("status")
    .isIn(["pending", "confirmed", "cancelled", "completed"])
    .withMessage("Status must be one of: pending, confirmed, cancelled, completed"),

  body("notes")
    .isString()
    .withMessage("Notes must be a string")
    .isLength({ max: 500 })
    .withMessage("Notes cannot exceed 500 characters")
    .optional(),
];

// Routes

/**
 * @route   POST /api/communication/messages
 * @desc    Send a message
 * @access  Private
 */
router.post(
  "/messages",
  auth,
  rateLimiter.general,
  messageValidation,
  communicationController.sendMessage
);

/**
 * @route   GET /api/communication/messages/inbox
 * @desc    Get user's inbox
 * @access  Private
 */
router.get(
  "/messages/inbox",
  auth,
  query("page").isInt({ min: 1 }).optional(),
  query("limit").isInt({ min: 1, max: 100 }).optional(),
  query("status").isIn(["sent", "read", "replied"]).optional(),
  communicationController.getInbox
);

/**
 * @route   GET /api/communication/messages/sent
 * @desc    Get user's sent messages
 * @access  Private
 */
router.get(
  "/messages/sent",
  auth,
  query("page").isInt({ min: 1 }).optional(),
  query("limit").isInt({ min: 1, max: 100 }).optional(),
  communicationController.getSentMessages
);

/**
 * @route   GET /api/communication/messages/conversation/:userId
 * @desc    Get conversation between two users
 * @access  Private
 */
router.get(
  "/messages/conversation/:userId",
  auth,
  param("userId").isMongoId().withMessage("Invalid user ID"),
  query("page").isInt({ min: 1 }).optional(),
  query("limit").isInt({ min: 1, max: 100 }).optional(),
  communicationController.getConversation
);

/**
 * @route   PUT /api/communication/messages/:id/read
 * @desc    Mark message as read
 * @access  Private
 */
router.put(
  "/messages/:id/read",
  auth,
  rateLimiter.general,
  param("id").isMongoId().withMessage("Invalid message ID"),
  communicationController.markAsRead
);

/**
 * @route   POST /api/communication/viewings
 * @desc    Request property viewing
 * @access  Private
 */
router.post(
  "/viewings",
  auth,
  rateLimiter.general,
  viewingValidation,
  communicationController.requestViewing
);

/**
 * @route   GET /api/communication/viewings
 * @desc    Get viewing requests for a user
 * @access  Private
 */
router.get(
  "/viewings",
  auth,
  query("page").isInt({ min: 1 }).optional(),
  query("limit").isInt({ min: 1, max: 100 }).optional(),
  query("status").isIn(["pending", "confirmed", "cancelled", "completed"]).optional(),
  query("role").isIn(["tenant", "landlord"]).optional(),
  communicationController.getViewings
);

/**
 * @route   PUT /api/communication/viewings/:id/status
 * @desc    Update viewing request status (landlord only)
 * @access  Private
 */
router.put(
  "/viewings/:id/status",
  auth,
  rateLimiter.general,
  param("id").isMongoId().withMessage("Invalid viewing ID"),
  viewingStatusValidation,
  communicationController.updateViewingStatus
);

export { router as communicationRoutes }; 