import type { Request, Response } from "express";
import { validationResult } from "express-validator";
import { Property } from "@/models/Property";
import { User } from "@/models/User";
import type { ApiResponse, PropertyCreateRequest } from "@/types";
import { logger } from "@/utils/logger";
import { uploadToCloudinary } from "@/config/cloudinary";

export class PropertyController {
  /**
   * Get all properties with filtering
   * GET /api/properties
   */
  public async getProperties(req: Request, res: Response): Promise<void> {
    try {
      const {
        page = 1,
        limit = 10,
        location,
        minRent,
        maxRent,
        bedrooms,
        bathrooms,
        amenities,
        status = "available",
      } = req.query;

      // Build query
      const query: any = { status };

      if (location) {
        query.$or = [
          { "location.city": new RegExp(location as string, "i") },
          { "location.address": new RegExp(location as string, "i") },
        ];
      }

      if (minRent || maxRent) {
        query.rent = {};
        if (minRent) query.rent.$gte = Number.parseInt(minRent as string);
        if (maxRent) query.rent.$lte = Number.parseInt(maxRent as string);
      }

      if (bedrooms) {
        query.bedrooms = { $gte: Number.parseInt(bedrooms as string) };
      }

      if (bathrooms) {
        query.bathrooms = { $gte: Number.parseInt(bathrooms as string) };
      }

      if (amenities) {
        const amenityList = Array.isArray(amenities) ? amenities : [amenities];
        query.amenities = { $in: amenityList };
      }

      // Execute query with pagination
      const pageNum = Number.parseInt(page as string);
      const limitNum = Number.parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      const [properties, total] = await Promise.all([
        Property.find(query)
          .populate("landlordId", "name email phone")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Property.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limitNum);

      res.status(200).json({
        success: true,
        message: "Properties retrieved successfully",
        data: properties,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get properties", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve properties",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get property by ID
   * GET /api/properties/:id
   */
  public async getPropertyById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const property = await Property.findById(id).populate(
        "landlordId",
        "name email phone"
      );

      if (!property) {
        res.status(404).json({
          success: false,
          message: "Property not found",
        } as ApiResponse);
        return;
      }

      // Increment view count
      await Property.findByIdAndUpdate(id, { $inc: { views: 1 } });

      res.status(200).json({
        success: true,
        message: "Property retrieved successfully",
        data: property,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get property", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve property",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Create new property with images
   * POST /api/properties
   */
  public async createProperty(req: Request, res: Response): Promise<void> {
    console.log('DEBUG: req.files =', req.files)
    try {
      console.log("Received request body:", req.body) // Debug log
      console.log("Received files:", req.files) // Debug log
      
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log("Validation errors:", errors.array()) // Debug log
        res.status(400).json({
          success: false,
          message: "Validation failed",
          error: JSON.stringify(errors.array()),
        } as ApiResponse);
        return;
      }

      // Verify user is a landlord
      const user = await User.findById(req.user!.id);
      if (!user || user.userType !== "landlord") {
        res.status(403).json({
          success: false,
          message: "Only landlords can create properties",
        } as ApiResponse);
        return;
      }

      // Parse form data
      const propertyData = {
        title: req.body.title,
        description: req.body.description,
        location: {
          address: req.body.location?.address || req.body['location.address'],
          city: req.body.location?.city || req.body['location.city'],
          state: req.body.location?.state || req.body['location.state'],
        },
        rent: Number(req.body.rent),
        bedrooms: Number(req.body.bedrooms),
        bathrooms: Number(req.body.bathrooms),
        size: req.body.size ? Number(req.body.size) : undefined,
        // Handle amenities array from form data
        amenities: Array.isArray(req.body.amenities) ? req.body.amenities : 
                  (req.body.amenities ? [req.body.amenities] : []),
        features: {
          furnished: req.body.features?.furnished === 'true' || req.body['features.furnished'] === 'true' || false,
          petFriendly: req.body.features?.petFriendly === 'true' || req.body['features.petFriendly'] === 'true' || false,
          parking: req.body.features?.parking === 'true' || req.body['features.parking'] === 'true' || false,
          balcony: req.body.features?.balcony === 'true' || req.body['features.balcony'] === 'true' || false,
        },
        utilities: {
          electricity: req.body.utilities?.electricity === 'true' || req.body['utilities.electricity'] === 'true' || true,
          water: req.body.utilities?.water === 'true' || req.body['utilities.water'] === 'true' || true,
          internet: req.body.utilities?.internet === 'true' || req.body['utilities.internet'] === 'true' || false,
          gas: req.body.utilities?.gas === 'true' || req.body['utilities.gas'] === 'true' || false,
        },
      };

      // Handle image uploads if any
      let imageUrls: string[] = [];
      if (req.files && Array.isArray(req.files)) {
        try {
          const uploadPromises = (req.files as Express.Multer.File[]).map(file => 
            uploadToCloudinary(file)
          );
          const uploadResults = await Promise.all(uploadPromises);
          imageUrls = uploadResults;
        } catch (uploadError) {
          logger.error("Failed to upload images", uploadError);
          res.status(500).json({
            success: false,
            message: "Failed to upload images",
            error: uploadError instanceof Error ? uploadError.message : "Unknown error",
          } as ApiResponse);
          return;
        }
      }

      const property = new Property({
        ...propertyData,
        landlordId: req.user!.id,
        images: imageUrls,
      });

      await property.save();

      logger.info("Property created successfully", {
        propertyId: property._id,
        landlordId: req.user!.id,
        title: property.title,
        imageCount: imageUrls.length,
      });

      res.status(201).json({
        success: true,
        message: "Property created successfully",
        data: property,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to create property", error);
      res.status(500).json({
        success: false,
        message: "Failed to create property",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Update property
   * PUT /api/properties/:id
   */
  public async updateProperty(req: Request, res: Response): Promise<void> {
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

      // Find property and verify ownership
      const property = await Property.findById(id);
      if (!property) {
        res.status(404).json({
          success: false,
          message: "Property not found",
        } as ApiResponse);
        return;
      }

      if (property.landlordId.toString() !== req.user!.id) {
        res.status(403).json({
          success: false,
          message: "Not authorized to update this property",
        } as ApiResponse);
        return;
      }

      // --- IMAGE HANDLING LOGIC ---
      // Parse imagesToKeep and imagesToDelete from body
      let imagesToKeep: string[] = [];
      if (Array.isArray(req.body.imagesToKeep)) {
        imagesToKeep = req.body.imagesToKeep;
      } else if (req.body.imagesToKeep) {
        imagesToKeep = [req.body.imagesToKeep];
      }
      let imagesToDelete: string[] = [];
      if (Array.isArray(req.body.imagesToDelete)) {
        imagesToDelete = req.body.imagesToDelete;
      } else if (req.body.imagesToDelete) {
        imagesToDelete = [req.body.imagesToDelete];
      }
      // Remove imagesToDelete from imagesToKeep (defensive)
      imagesToKeep = imagesToKeep.filter(url => !imagesToDelete.includes(url));

      // Upload new images if any
      let newImageUrls: string[] = [];
      if (req.files && Array.isArray(req.files)) {
        try {
          const uploadPromises = (req.files as Express.Multer.File[]).map(file => uploadToCloudinary(file));
          const uploadResults = await Promise.all(uploadPromises);
          newImageUrls = uploadResults;
        } catch (uploadError) {
          logger.error("Failed to upload images", uploadError);
          res.status(500).json({
            success: false,
            message: "Failed to upload images",
            error: uploadError instanceof Error ? uploadError.message : "Unknown error",
          } as ApiResponse);
          return;
        }
      }

      // Merge all images
      const finalImages = [...imagesToKeep, ...newImageUrls];
      updateData.images = finalImages;

      // Remove imagesToKeep/imagesToDelete from updateData to avoid schema issues
      delete updateData.imagesToKeep;
      delete updateData.imagesToDelete;

      const updatedProperty = await Property.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
      }).populate("landlordId", "name email phone");

      logger.info("Property updated successfully", {
        propertyId: id,
        landlordId: req.user!.id,
      });

      res.status(200).json({
        success: true,
        message: "Property updated successfully",
        data: updatedProperty,
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to update property", error);
      res.status(500).json({
        success: false,
        message: "Failed to update property",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Delete property
   * DELETE /api/properties/:id
   */
  public async deleteProperty(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      // Find property and verify ownership
      const property = await Property.findById(id);
      if (!property) {
        res.status(404).json({
          success: false,
          message: "Property not found",
        } as ApiResponse);
        return;
      }

      if (property.landlordId.toString() !== req.user!.id) {
        res.status(403).json({
          success: false,
          message: "Not authorized to delete this property",
        } as ApiResponse);
        return;
      }

      await Property.findByIdAndDelete(id);

      logger.info("Property deleted successfully", {
        propertyId: id,
        landlordId: req.user!.id,
      });

      res.status(200).json({
        success: true,
        message: "Property deleted successfully",
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to delete property", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete property",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Get properties by landlord
   * GET /api/properties/landlord/:landlordId
   */
  public async getPropertiesByLandlord(
    req: Request,
    res: Response
  ): Promise<void> {
    try {
      const { landlordId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = Number.parseInt(page as string);
      const limitNum = Number.parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      const [properties, total] = await Promise.all([
        Property.find({ landlordId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Property.countDocuments({ landlordId }),
      ]);

      const totalPages = Math.ceil(total / limitNum);

      res.status(200).json({
        success: true,
        message: "Landlord properties retrieved successfully",
        data: properties,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to get landlord properties", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve landlord properties",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }

  /**
   * Delete an image from a property
   * DELETE /api/properties/:id/images/:imageIndex
   */
  public async deleteImage(req: Request, res: Response): Promise<void> {
    try {
      const { id, imageIndex } = req.params;
      const index = parseInt(imageIndex);

      // Find property and verify ownership
      const property = await Property.findById(id);
      if (!property) {
        res.status(404).json({
          success: false,
          message: "Property not found",
        } as ApiResponse);
        return;
      }

      if (property.landlordId.toString() !== req.user!.id) {
        res.status(403).json({
          success: false,
          message: "Not authorized to delete images from this property",
        } as ApiResponse);
        return;
      }

      if (index < 0 || index >= property.images.length) {
        res.status(400).json({
          success: false,
          message: "Invalid image index",
        } as ApiResponse);
        return;
      }

      // Remove image from array
      const deletedImage = property.images.splice(index, 1)[0];
      await property.save();

      logger.info("Image deleted successfully", {
        propertyId: id,
        landlordId: req.user!.id,
        imageUrl: deletedImage,
      });

      res.status(200).json({
        success: true,
        message: "Image deleted successfully",
        data: {
          propertyId: id,
          deletedImage,
          remainingImages: property.images.length,
        },
      } as ApiResponse);
    } catch (error) {
      logger.error("Failed to delete image", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete image",
        error: error instanceof Error ? error.message : "Unknown error",
      } as ApiResponse);
    }
  }
}

export const propertyController = new PropertyController();
