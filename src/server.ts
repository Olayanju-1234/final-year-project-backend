import "dotenv/config";
import 'module-alias/register';
import 'tsconfig-paths/register';
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { database } from "@/config/database";
import { logger } from "@/utils/logger";
import { rateLimiter } from "@/middleware/rateLimiter";

// Import routes
import { authRoutes } from "@/routes/auth";
import { propertyRoutes } from "@/routes/properties";
import { optimizationRoutes } from "@/routes/optimization";
import { tenantRoutes } from "@/routes/tenants";
import { communicationRoutes } from "@/routes/communication";

class Server {
  private app: express.Application;
  private port: number;

  constructor() {
    this.app = express();
    this.port = Number.parseInt(process.env.PORT || "3001");

    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(helmet());

    // CORS configuration
    this.app.use(
      cors({
        origin:
          process.env.NODE_ENV === "production"
            ? ["https://final-year-project-frontend-sandy.vercel.app/"]
            : [
                "http://localhost:3000",
                "http://localhost:3001",
                "https://final-year-project-frontend-sandy.vercel.app/",
                "http://localhost:3001/api/v1",
              ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "Cache-Control",
          "Pragma",
        ],
      })
    );

    // Compression middleware
    this.app.use(compression() as any);
    // Logging middleware
    if (process.env.NODE_ENV === "development") {
      this.app.use(morgan("dev"));
    } else {
      this.app.use(morgan("combined"));
    }

    // Body parsing middleware
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // General rate limiting
    this.app.use(rateLimiter.general);

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.status(200).json({
        success: true,
        message: "RentMatch API is running",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: "1.0.0",
      });
    });
  }

  private initializeRoutes(): void {
    const apiVersion = process.env.API_VERSION || "v1";

    // API routes
    this.app.use(`/api/${apiVersion}/auth`, authRoutes);
    this.app.use(`/api/${apiVersion}/properties`, propertyRoutes);
    this.app.use(`/api/${apiVersion}/optimization`, optimizationRoutes);
    this.app.use(`/api/${apiVersion}/tenants`, tenantRoutes);
    this.app.use(`/api/${apiVersion}/communication`, communicationRoutes);

    // 404 handler for undefined routes
    this.app.use("*", (req, res) => {
      res.status(404).json({
        success: false,
        message: "Route not found",
        error: `Cannot ${req.method} ${req.originalUrl}`,
      });
    });
  }

  private initializeErrorHandling(): void {
    // Global error handler
    this.app.use(
      (
        error: any,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        logger.error("Unhandled error:", {
          error: error.message,
          stack: error.stack,
          url: req.originalUrl,
          method: req.method,
          ip: req.ip,
        });

        // Mongoose validation error
        if (error.name === "ValidationError") {
          const errors = Object.values(error.errors).map(
            (err: any) => err.message
          );
          return res.status(400).json({
            success: false,
            message: "Validation Error",
            error: errors,
          });
        }

        // Mongoose duplicate key error
        if (error.code === 11000) {
          const field = Object.keys(error.keyValue)[0];
          return res.status(400).json({
            success: false,
            message: "Duplicate field value",
            error: `${field} already exists`,
          });
        }

        // JWT errors
        if (error.name === "JsonWebTokenError") {
          return res.status(401).json({
            success: false,
            message: "Invalid token",
          });
        }

        if (error.name === "TokenExpiredError") {
          return res.status(401).json({
            success: false,
            message: "Token expired",
          });
        }

        // Default error
        return res.status(error.status || 500).json({
          success: false,
          message: error.message || "Internal Server Error",
          ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
        });
      }
    );
  }

  public async start(): Promise<void> {
    try {
      // Connect to database
      await database.connect();

      // Start server
      this.app.listen(this.port, () => {
        logger.info(`🚀 RentMatch API Server started successfully`);
        logger.info(`📍 Server running on port ${this.port}`);
        logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
        logger.info(`🔗 Health check: http://localhost:${this.port}/health`);
        logger.info(`📊 Linear Programming Optimization API ready`);
      });

      // Graceful shutdown
      process.on("SIGTERM", this.gracefulShutdown.bind(this));
      process.on("SIGINT", this.gracefulShutdown.bind(this));
    } catch (error) {
      logger.error("Failed to start server:", error);
      process.exit(1);
    }
  }

  private async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    try {
      await database.disconnect();
      logger.info("Database disconnected successfully");

      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  }
}

// Start the server
const server = new Server();
server.start();

export default server;
