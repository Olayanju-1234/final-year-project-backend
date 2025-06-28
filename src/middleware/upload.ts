import multer from "multer"
import { Request, Response, NextFunction } from "express"

// Configure multer for memory storage
const storage = multer.memoryStorage()

// File filter to only allow images
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check if file is an image
  if (file.mimetype.startsWith("image/")) {
    cb(null, true)
  } else {
    cb(new Error("Only image files are allowed"))
  }
}

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10 // Maximum 10 files
  }
})

// Middleware for single image upload
export const uploadSingle: ReturnType<typeof upload.single> = upload.single("image")

// Middleware for multiple images upload
export const uploadMultiple: ReturnType<typeof upload.array> = upload.array("images", 10)

// Error handling middleware for multer
export const handleUploadError = (error: any, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File too large. Maximum size is 5MB"
      })
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files. Maximum is 10 files"
      })
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: "Unexpected file field"
      })
    }
  }
  
  if (error.message === "Only image files are allowed") {
    return res.status(400).json({
      success: false,
      message: "Only image files are allowed"
    })
  }

  return next(error)
}

export default upload 