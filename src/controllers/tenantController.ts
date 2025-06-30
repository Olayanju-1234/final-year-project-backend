import type { Request, Response } from "express";
import { Tenant } from "@/models/Tenant";
import { User } from "@/models/User";
import type { ApiResponse, ITenant } from "@/types";
import { logger } from "@/utils/logger";
import { validationResult } from "express-validator";

export class TenantController {
  /**
   * Get tenant profile by ID
   * GET /api/tenants/:id
   */
  public async getTenantProfile(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const tenant = await Tenant.findById(id).populate("userId", "name email phone");
      if (!tenant) {
        res.status(404).json({
          success: false,
          message: "Tenant profile not found",
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        message: "Tenant profile retrieved successfully",
        data: tenant,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get tenant profile", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve tenant profile",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Update tenant profile
   * PUT /api/tenants/:id
   */
  public async updateTenantProfile(req: Request, res: Response): Promise<void> {
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

      const { id } = req.params;
      const updateData = req.body;

      const tenant = await Tenant.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      ).populate("userId", "name email phone");

      if (!tenant) {
        res.status(404).json({
          success: false,
          message: "Tenant profile not found",
        } as ApiResponse);
        return;
      }

      logger.info("Tenant profile updated", { tenantId: id });

      res.status(200).json({
        success: true,
        message: "Tenant profile updated successfully",
        data: tenant,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to update tenant profile", error);
      res.status(500).json({
        success: false,
        message: "Failed to update tenant profile",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Update tenant preferences
   * PUT /api/tenants/:id/preferences
   */
  public async updatePreferences(req: Request, res: Response): Promise<void> {
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

      const { id } = req.params;
      const preferences = req.body.preferences || req.body;

      // Defensive: ensure all fields are present
      const update: any = {};
      if (preferences.budget) update["preferences.budget"] = preferences.budget;
      if (preferences.preferredLocation) update["preferences.preferredLocation"] = preferences.preferredLocation;
      if (preferences.requiredAmenities) update["preferences.requiredAmenities"] = preferences.requiredAmenities;
      if (preferences.preferredBedrooms) update["preferences.preferredBedrooms"] = preferences.preferredBedrooms;
      if (preferences.preferredBathrooms) update["preferences.preferredBathrooms"] = preferences.preferredBathrooms;
      if (preferences.maxCommute) update["preferences.maxCommute"] = preferences.maxCommute;
      if (preferences.features) update["preferences.features"] = preferences.features;
      if (preferences.utilities) update["preferences.utilities"] = preferences.utilities;

      const tenant = await Tenant.findByIdAndUpdate(
        id,
        update,
        { new: true, runValidators: true }
      ).populate("userId", "name email phone");

      if (!tenant) {
        res.status(404).json({
          success: false,
          message: "Tenant profile not found",
        } as ApiResponse);
        return;
      }

      logger.info("Tenant preferences updated", { tenantId: id });

      res.status(200).json({
        success: true,
        message: "Tenant preferences updated successfully",
        data: tenant,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to update tenant preferences", error);
      res.status(500).json({
        success: false,
        message: "Failed to update tenant preferences",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get tenant's saved properties
   * GET /api/tenants/:id/saved-properties
   */
  public async getSavedProperties(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const tenant = await Tenant.findById(id).populate({
        path: "savedProperties",
        options: {
          skip: (Number(page) - 1) * Number(limit),
          limit: Number(limit),
          sort: { createdAt: -1 },
        },
      });

      if (!tenant) {
        res.status(404).json({
          success: false,
          message: "Tenant profile not found",
        } as ApiResponse);
        return;
      }

      const total = tenant.savedProperties.length;

      res.status(200).json({
        success: true,
        message: "Saved properties retrieved successfully",
        data: tenant.savedProperties,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get saved properties", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve saved properties",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Add property to saved properties
   * POST /api/tenants/:id/saved-properties
   */
  public async addSavedProperty(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { propertyId } = req.body;

      const tenant = await Tenant.findByIdAndUpdate(
        id,
        { $addToSet: { savedProperties: propertyId } },
        { new: true }
      ).populate("userId", "name email phone");

      if (!tenant) {
        res.status(404).json({
          success: false,
          message: "Tenant profile not found",
        } as ApiResponse);
        return;
      }

      logger.info("Property added to saved properties", { tenantId: id, propertyId });

      res.status(200).json({
        success: true,
        message: "Property added to saved properties successfully",
        data: tenant,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to add saved property", error);
      res.status(500).json({
        success: false,
        message: "Failed to add property to saved properties",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Remove property from saved properties
   * DELETE /api/tenants/:id/saved-properties/:propertyId
   */
  public async removeSavedProperty(req: Request, res: Response): Promise<void> {
    try {
      const { id, propertyId } = req.params;

      const tenant = await Tenant.findByIdAndUpdate(
        id,
        { $pull: { savedProperties: propertyId } },
        { new: true }
      ).populate("userId", "name email phone");

      if (!tenant) {
        res.status(404).json({
          success: false,
          message: "Tenant profile not found",
        } as ApiResponse);
        return;
      }

      logger.info("Property removed from saved properties", { tenantId: id, propertyId });

      res.status(200).json({
        success: true,
        message: "Property removed from saved properties successfully",
        data: tenant,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to remove saved property", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove property from saved properties",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get tenant's search history
   * GET /api/tenants/:id/search-history
   */
  public async getSearchHistory(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const tenant = await Tenant.findById(id).populate({
        path: "searchHistory",
        options: {
          skip: (Number(page) - 1) * Number(limit),
          limit: Number(limit),
          sort: { createdAt: -1 },
        },
      });

      if (!tenant) {
        res.status(404).json({
          success: false,
          message: "Tenant profile not found",
        } as ApiResponse);
        return;
      }

      const total = tenant.searchHistory.length;

      res.status(200).json({
        success: true,
        message: "Search history retrieved successfully",
        data: tenant.searchHistory,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get search history", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve search history",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }
}

export const tenantController = new TenantController(); 