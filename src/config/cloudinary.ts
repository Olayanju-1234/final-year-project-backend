import { v2 as cloudinary } from "cloudinary"
import { logger } from "@/utils/logger"

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export const uploadToCloudinary = async (file: Express.Multer.File): Promise<string> => {
  try {
    // Convert buffer to base64
    const base64String = file.buffer.toString("base64")
    const dataURI = `data:${file.mimetype};base64,${base64String}`

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: "rentmatch-properties",
      resource_type: "auto",
      transformation: [
        { width: 800, height: 600, crop: "fill" },
        { quality: "auto" },
        { fetch_format: "auto" }
      ]
    })

    logger.info("Image uploaded to Cloudinary", {
      publicId: result.public_id,
      url: result.secure_url,
      size: file.size
    })

    return result.secure_url
  } catch (error) {
    logger.error("Failed to upload image to Cloudinary", error)
    throw new Error("Failed to upload image")
  }
}

export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId)
    logger.info("Image deleted from Cloudinary", { publicId })
  } catch (error) {
    logger.error("Failed to delete image from Cloudinary", error)
    throw new Error("Failed to delete image")
  }
}

export default cloudinary 