import type { Request, Response } from "express";
import { Message } from "@/models/Message";
import { Viewing } from "@/models/Viewing";
import { Property } from "@/models/Property";
import { User } from "@/models/User";
import type { ApiResponse, IMessage, IViewing } from "@/types";
import { logger } from "@/utils/logger";
import { validationResult } from "express-validator";

export class CommunicationController {
  /**
   * Send a message
   * POST /api/communication/messages
   */
  public async sendMessage(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          error: errors
            .array()
            .map((e) => e.msg)
            .join(", "),
        } as ApiResponse);
        return;
      }

      const { toUserId, propertyId, subject, message, messageType = "general" } = req.body;
      const fromUserId = req.user?.id;

      // Verify recipient exists
      const recipient = await User.findById(toUserId);
      if (!recipient) {
        res.status(404).json({
          success: false,
          message: "Recipient not found",
        } as ApiResponse);
        return;
      }

      // Verify property exists if propertyId is provided
      if (propertyId) {
        const property = await Property.findById(propertyId);
        if (!property) {
          res.status(404).json({
            success: false,
            message: "Property not found",
          } as ApiResponse);
          return;
        }
      }

      const newMessage = await Message.create({
        fromUserId,
        toUserId,
        propertyId,
        subject,
        message,
        messageType,
      });

      const populatedMessage = await Message.findById(newMessage._id)
        .populate("fromUserId", "name email")
        .populate("toUserId", "name email")
        .populate("propertyId", "title location");

      logger.info("Message sent successfully", {
        messageId: newMessage._id,
        fromUserId,
        toUserId,
        messageType,
      });

      res.status(201).json({
        success: true,
        message: "Message sent successfully",
        data: populatedMessage,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to send message", error);
      res.status(500).json({
        success: false,
        message: "Failed to send message",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get messages for a user (inbox)
   * GET /api/communication/messages/inbox
   */
  public async getInbox(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { page = 1, limit = 20, status } = req.query;

      const filter: any = { toUserId: userId };
      if (status) {
        filter.status = status;
      }

      const messages = await Message.find(filter)
        .populate("fromUserId", "name email")
        .populate("propertyId", "title location")
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

      const total = await Message.countDocuments(filter);

      res.status(200).json({
        success: true,
        message: "Inbox retrieved successfully",
        data: messages,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get inbox", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve inbox",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get sent messages for a user
   * GET /api/communication/messages/sent
   */
  public async getSentMessages(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { page = 1, limit = 20 } = req.query;

      const messages = await Message.find({ fromUserId: userId })
        .populate("toUserId", "name email")
        .populate("propertyId", "title location")
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

      const total = await Message.countDocuments({ fromUserId: userId });

      res.status(200).json({
        success: true,
        message: "Sent messages retrieved successfully",
        data: messages,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get sent messages", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve sent messages",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get conversation between two users
   * GET /api/communication/messages/conversation/:userId
   */
  public async getConversation(req: Request, res: Response): Promise<void> {
    try {
      const currentUserId = req.user?.id;
      const { userId } = req.params;
      const { page = 1, limit = 50 } = req.query;

      const messages = await Message.find({
        $or: [
          { fromUserId: currentUserId, toUserId: userId },
          { fromUserId: userId, toUserId: currentUserId },
        ],
      })
        .populate("fromUserId", "name email")
        .populate("toUserId", "name email")
        .populate("propertyId", "title location")
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

      const total = await Message.countDocuments({
        $or: [
          { fromUserId: currentUserId, toUserId: userId },
          { fromUserId: userId, toUserId: currentUserId },
        ],
      });

      res.status(200).json({
        success: true,
        message: "Conversation retrieved successfully",
        data: messages.reverse(), // Show oldest first
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get conversation", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve conversation",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Mark message as read
   * PUT /api/communication/messages/:id/read
   */
  public async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const message = await Message.findOneAndUpdate(
        { _id: id, toUserId: userId },
        { status: "read" },
        { new: true }
      ).populate("fromUserId", "name email");

      if (!message) {
        res.status(404).json({
          success: false,
          message: "Message not found",
        } as ApiResponse);
        return;
      }

      logger.info("Message marked as read", { messageId: id, userId });

      res.status(200).json({
        success: true,
        message: "Message marked as read",
        data: message,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to mark message as read", error);
      res.status(500).json({
        success: false,
        message: "Failed to mark message as read",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Request property viewing
   * POST /api/communication/viewings
   */
  public async requestViewing(req: Request, res: Response): Promise<void> {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          error: errors
            .array()
            .map((e) => e.msg)
            .join(", "),
        } as ApiResponse);
        return;
      }

      const { propertyId, requestedDate, requestedTime, notes } = req.body;
      const tenantId = req.user?.id;

      // Verify property exists and get landlord
      const property = await Property.findById(propertyId);
      if (!property) {
        res.status(404).json({
          success: false,
          message: "Property not found",
        } as ApiResponse);
        return;
      }

      const viewing = await Viewing.create({
        tenantId,
        landlordId: property.landlordId,
        propertyId,
        requestedDate,
        requestedTime,
        notes,
      });

      const populatedViewing = await Viewing.findById(viewing._id)
        .populate("tenantId", "name email")
        .populate("landlordId", "name email")
        .populate("propertyId", "title location");

      logger.info("Viewing request created", {
        viewingId: viewing._id,
        propertyId,
        tenantId,
        landlordId: property.landlordId,
      });

      res.status(201).json({
        success: true,
        message: "Viewing request sent successfully",
        data: populatedViewing,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to request viewing", error);
      res.status(500).json({
        success: false,
        message: "Failed to request viewing",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get viewing requests for a user
   * GET /api/communication/viewings
   */
  public async getViewings(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { page = 1, limit = 20, status, role = "tenant" } = req.query;

      const filter: any = role === "landlord" ? { landlordId: userId } : { tenantId: userId };
      if (status) {
        filter.status = status;
      }

      const viewings = await Viewing.find(filter)
        .populate("tenantId", "name email")
        .populate("landlordId", "name email")
        .populate("propertyId", "title location")
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit));

      const total = await Viewing.countDocuments(filter);

      res.status(200).json({
        success: true,
        message: "Viewing requests retrieved successfully",
        data: viewings,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get viewing requests", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve viewing requests",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Update viewing request status
   * PUT /api/communication/viewings/:id/status
   */
  public async updateViewingStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const userId = req.user?.id;

      const viewing = await Viewing.findOneAndUpdate(
        { _id: id, landlordId: userId },
        { status, ...(notes && { notes }) },
        { new: true }
      )
        .populate("tenantId", "name email")
        .populate("landlordId", "name email")
        .populate("propertyId", "title location");

      if (!viewing) {
        res.status(404).json({
          success: false,
          message: "Viewing request not found",
        } as ApiResponse);
        return;
      }

      logger.info("Viewing status updated", { viewingId: id, status, userId });

      res.status(200).json({
        success: true,
        message: "Viewing status updated successfully",
        data: viewing,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to update viewing status", error);
      res.status(500).json({
        success: false,
        message: "Failed to update viewing status",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }
}

export const communicationController = new CommunicationController(); 