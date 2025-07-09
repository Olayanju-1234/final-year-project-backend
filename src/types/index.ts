import type { Document, Types } from "mongoose";

// Base API Response
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// User Types
export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  phone: string;
  profileImage?: string;
  userType: "tenant" | "landlord" | "admin";
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

// Tenant Types
export interface ITenant extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId | IUser;
  preferences: {
    budget: {
      min: number;
      max: number;
    };
    preferredLocation: string;
    requiredAmenities: string[];
    preferredBedrooms: number;
    preferredBathrooms: number;
    maxCommute?: number; // in minutes
    features?: {
      furnished: boolean;
      petFriendly: boolean;
      parking: boolean;
      balcony: boolean;
    };
    utilities?: {
      electricity: boolean;
      water: boolean;
      internet: boolean;
      gas: boolean;
    };
  };
  searchHistory: Types.ObjectId[] | IProperty[];
  savedProperties: Types.ObjectId[] | IProperty[];
  createdAt: Date;
  updatedAt: Date;
}

// Property Types
export interface IProperty extends Document {
  _id: Types.ObjectId;
  landlordId: Types.ObjectId;
  title: string;
  description: string;
  location: {
    address: string;
    city: string;
    state: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  rent: number;
  bedrooms: number;
  bathrooms: number;
  size?: number; // in square meters
  amenities: string[];
  images: string[];
  status: "available" | "occupied" | "maintenance" | "pending";
  features: {
    furnished: boolean;
    petFriendly: boolean;
    parking: boolean;
    balcony: boolean;
  };
  utilities: {
    electricity: boolean;
    water: boolean;
    internet: boolean;
    gas: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
  views: number;
  inquiries: number;
}

// Linear Programming Types
export interface OptimizationConstraints {
  tenantId?: string;
  budget: {
    min: number;
    max: number;
  };
  location: string;
  amenities: string[];
  bedrooms: number;
  bathrooms: number;
  maxCommute?: number;
  features?: {
    furnished: boolean;
    petFriendly: boolean;
    parking: boolean;
    balcony: boolean;
  };
  utilities?: {
    electricity: boolean;
    water: boolean;
    internet: boolean;
    gas: boolean;
  };
}

export interface OptimizationWeights {
  budget: number;
  location: number;
  amenities: number;
  size: number;
  features: number;
  utilities: number;
}

export interface PropertyMatch {
  propertyId: Types.ObjectId;
  tenantId: Types.ObjectId | string | undefined;
  matchScore: number;
  matchDetails: {
    budgetScore: number;
    locationScore: number;
    amenityScore: number;
    sizeScore: number;
    featureScore: number;
    utilityScore: number;
  };
  explanation: string[];
  calculatedAt: Date;
}

export interface OptimizationResult {
  matches: PropertyMatch[];
  optimizationDetails: {
    algorithm: "linear_programming" | "greedy_matching";
    executionTime: number;
    constraintsSatisfied: string[];
    objectiveValue: number;
    totalPropertiesEvaluated: number;
    feasibleSolutions: number;
  };
  weights: OptimizationWeights;
  constraints: OptimizationConstraints;
}

// Communication Types
export interface IMessage extends Document {
  _id: Types.ObjectId;
  fromUserId: Types.ObjectId;
  toUserId: Types.ObjectId;
  propertyId?: Types.ObjectId;
  subject: string;
  message: string;
  messageType: "inquiry" | "viewing_request" | "general" | "system";
  status: "sent" | "read" | "replied";
  createdAt: Date;
  updatedAt: Date;
}

export interface IViewing extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  landlordId: Types.ObjectId;
  propertyId: Types.ObjectId;
  requestedDate: Date;
  requestedTime: string;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Analytics Types
export interface OptimizationStats {
  totalOptimizations: number;
  averageExecutionTime: number;
  averageMatchScore: number;
  constraintsSatisfactionRate: number;
  mostRequestedAmenities: Array<{
    amenity: string;
    count: number;
  }>;
  popularLocations: Array<{
    location: string;
    count: number;
  }>;
  budgetDistribution: Array<{
    range: string;
    count: number;
  }>;
}

// Request/Response Types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  phone: string;
  userType: "tenant" | "landlord";
  preferences?: Partial<ITenant["preferences"]>;
}

export interface PropertyCreateRequest {
  title: string;
  description: string;
  location: IProperty["location"];
  rent: number;
  bedrooms: number;
  bathrooms: number;
  size?: number;
  amenities: string[];
  features: IProperty["features"];
  utilities: IProperty["utilities"];
}

export interface OptimizationRequest {
  tenantId?: string;
  constraints: OptimizationConstraints;
  weights?: Partial<OptimizationWeights>;
  maxResults?: number;
}

export interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  profileImage?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
