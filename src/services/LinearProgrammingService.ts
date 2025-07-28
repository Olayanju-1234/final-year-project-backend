import { Matrix } from "ml-matrix";
import { Property } from "@/models/Property";
import type {
  OptimizationConstraints,
  OptimizationWeights,
  OptimizationResult,
  PropertyMatch,
} from "@/types";
import { logger } from "@/utils/logger";
import { Tenant } from "@/models/Tenant";
// --- LP Solver import ---
// You must install this package: yarn add javascript-lp-solver
// @ts-ignore
const solver: any = require("javascript-lp-solver");

/**
 * Linear Programming Optimization Service
 *
 * This service implements a linear programming approach to optimize
 * tenant-property matching based on multiple constraints and objectives.
 *
 * The optimization model:
 * - Objective: Maximize weighted satisfaction score
 * - Constraints: Budget, location, amenities, size requirements
 * - Variables: Binary assignment variables for each property-tenant pair
 *
 * Uses 'javascript-lp-solver' for solving the assignment problem.
 */
export class LinearProgrammingService {
  private static instance: LinearProgrammingService;

  // Default optimization weights
  private readonly defaultWeights: OptimizationWeights = {
    budget: Number.parseFloat(process.env.LP_DEFAULT_WEIGHTS_BUDGET || "0.25"),
    location: Number.parseFloat(
      process.env.LP_DEFAULT_WEIGHTS_LOCATION || "0.2"
    ),
    amenities: Number.parseFloat(
      process.env.LP_DEFAULT_WEIGHTS_AMENITIES || "0.15"
    ),
    size: Number.parseFloat(process.env.LP_DEFAULT_WEIGHTS_SIZE || "0.15"),
    features: Number.parseFloat(
      process.env.LP_DEFAULT_WEIGHTS_FEATURES || "0.15"
    ),
    utilities: Number.parseFloat(
      process.env.LP_DEFAULT_WEIGHTS_UTILITIES || "0.1"
    ),
  };

  private readonly maxExecutionTime = Number.parseInt(
    process.env.LP_MAX_EXECUTION_TIME || "30000"
  );
  private readonly minMatchThreshold = Number.parseInt(
    process.env.MIN_MATCH_SCORE_THRESHOLD || "30"
  );

  public static getInstance(): LinearProgrammingService {
    if (!LinearProgrammingService.instance) {
      LinearProgrammingService.instance = new LinearProgrammingService();
    }
    return LinearProgrammingService.instance;
  }

  /**
   * Main optimization function using Linear Programming
   *
   * This replaces the previous greedy algorithm with a true LP assignment.
   */
  public async optimizeMatching(
    constraints: OptimizationConstraints,
    weights: Partial<OptimizationWeights> = {},
    maxResults = 5
  ): Promise<OptimizationResult> {
    const startTime = Date.now();

    try {
      logger.info("Starting optimization with Linear Programming algorithm", {
        constraints,
        weights,
      });

      // Merge weights with defaults
      const finalWeights: OptimizationWeights = {
        ...this.defaultWeights,
        ...weights,
      };

      // Validate weights sum to 1
      this.validateWeights(finalWeights);

      // Fetch available properties based on hard constraints
      const properties = await this.fetchEligibleProperties(constraints);

      logger.info(`[LP DEBUG] Properties fetched for matching: ${properties.length}`);
      if (properties.length > 0) {
        logger.info(`[LP DEBUG] First property sample:`, properties[0]);
      }

      if (properties.length === 0) {
        return this.createEmptyResult(constraints, finalWeights, startTime);
      }

      // --- LP Assignment ---
      const matches = await this.linearProgrammingAssignment(
        constraints,
        properties,
        finalWeights,
        maxResults
      );

      const executionTime = Date.now() - startTime;

      logger.info("Optimization completed", {
        executionTime,
        propertiesEvaluated: properties.length,
        matchesFound: matches.length,
      });

      return {
        matches,
        optimizationDetails: {
          algorithm: "linear_programming",
          executionTime,
          constraintsSatisfied: this.getConstraintsSatisfied(
            matches,
            constraints
          ),
          objectiveValue: this.calculateObjectiveValue(matches, finalWeights),
          totalPropertiesEvaluated: properties.length,
          feasibleSolutions: matches.length,
        },
        weights: finalWeights,
        constraints,
      };
    } catch (error) {
      logger.error("Optimization failed", error);
      throw new Error(
        `Optimization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Find best tenant matches for a given property
   */
  public async optimizeTenantMatching(
    property: any,
    maxResults = 5
  ): Promise<any> {
    const startTime = Date.now();
    const tenants = await Tenant.find({
      "preferences.budget": { $exists: true },
    })
      .populate("userId", "name")
      .lean();

    if (tenants.length === 0) {
      return {
        matches: [],
        optimizationDetails: {
          executionTime: Date.now() - startTime,
          matchesFound: 0,
        },
      };
    }

    const tenantScores = tenants.map((tenant) => {
      const constraints: OptimizationConstraints = {
        budget: tenant.preferences.budget,
        location: tenant.preferences.preferredLocation,
        amenities: tenant.preferences.requiredAmenities,
        bedrooms: tenant.preferences.preferredBedrooms,
        bathrooms: tenant.preferences.preferredBathrooms,
        features: tenant.preferences.features,
        utilities: tenant.preferences.utilities,
      };

      const score = this.calculateSatisfactionScore(
        property,
        constraints,
        this.defaultWeights
      );

      return {
        tenant: {
          _id: tenant._id,
          name: (tenant.userId as any)?.name || "N/A",
        },
        matchScore: Math.round(score),
        preferencesSummary: `Budget: ₦${tenant.preferences.budget.min}-₦${tenant.preferences.budget.max}, Location: ${tenant.preferences.preferredLocation}`,
      };
    });

    const matches = tenantScores
      .filter((match) => match.matchScore >= this.minMatchThreshold)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, maxResults);

    return {
      matches,
      optimizationDetails: {
        algorithm: "reverse_match",
        executionTime: Date.now() - startTime,
        matchesFound: matches.length,
        totalTenantsEvaluated: tenants.length,
      },
    };
  }

  /**
   * Fetch properties that meet hard constraints
   */
  private async fetchEligibleProperties(
    constraints: OptimizationConstraints
  ): Promise<any[]> {
    const query: any = {
      status: "available",
      rent: {
        $gte: constraints.budget.min,
        $lte: constraints.budget.max,
      },
      bedrooms: { $gte: constraints.bedrooms },
      bathrooms: { $gte: constraints.bathrooms },
    };

    // Location constraint (flexible matching)
    if (constraints.location) {
      query.$or = [
        { "location.city": new RegExp(constraints.location, "i") },
        { "location.address": new RegExp(constraints.location, "i") },
      ];
    }

    // Amenities constraint (at least some required amenities)
    if (constraints.amenities && constraints.amenities.length > 0) {
      query.amenities = { $in: constraints.amenities };
    }

    const maxProperties = Number.parseInt(
      process.env.MAX_PROPERTIES_PER_OPTIMIZATION || "100"
    );

    return await Property.find(query).limit(maxProperties).lean().exec();
  }

  /**
   * Calculate satisfaction score for a property
   */
  private calculateSatisfactionScore(
    property: any,
    constraints: OptimizationConstraints,
    weights: OptimizationWeights
  ): number {
    // Budget score (higher score for better value)
    const budgetScore = this.calculateBudgetScore(
      property.rent,
      constraints.budget
    );

    // Location score (exact match gets higher score)
    const locationScore = this.calculateLocationScore(
      property.location,
      constraints.location
    );

    // Amenities score (percentage of required amenities available)
    const amenityScore = this.calculateAmenityScore(
      property.amenities,
      constraints.amenities
    );

    // Size score (if size preference exists)
    const sizeScore = this.calculateSizeScore(property, constraints);

    // Features score
    const featureScore = this.calculateFeatureScore(
      property.features,
      constraints.features
    );

    // Utilities score
    const utilityScore = this.calculateUtilityScore(
      property.utilities,
      constraints.utilities
    );

    // Weighted combination
    const totalScore =
      weights.budget * budgetScore +
      weights.location * locationScore +
      weights.amenities * amenityScore +
      weights.size * sizeScore +
      weights.features * featureScore +
      weights.utilities * utilityScore;

    return Math.min(100, Math.max(0, totalScore));
  }

  /**
   * Calculate budget satisfaction score
   */
  private calculateBudgetScore(
    rent: number,
    budget: { min: number; max: number }
  ): number {
    if (rent >= budget.min && rent <= budget.max) return 100;

    // If rent is below min, score decreases linearly to 0 at 50% below min
    if (rent < budget.min) {
      const diff = budget.min - rent;
      const threshold = budget.min * 0.5; // 50% below min is 0 score
      return Math.max(0, 100 - (diff / threshold) * 100);
    }

    // If rent is above max, score decreases linearly to 0 at 50% above max
    if (rent > budget.max) {
      const diff = rent - budget.max;
      const threshold = budget.max * 0.5; // 50% above max is 0 score
      return Math.max(0, 100 - (diff / threshold) * 100);
    }

    return 0;
  }

  /**
   * Calculate location satisfaction score
   */
  private calculateLocationScore(
    propertyLocation: any,
    preferredLocation: string
  ): number {
    if (!preferredLocation) return 100;

    const city = propertyLocation.city?.toLowerCase() || "";
    const address = propertyLocation.address?.toLowerCase() || "";
    const preferred = preferredLocation.toLowerCase();

    // Exact city match
    if (city.includes(preferred) || preferred.includes(city)) return 100;

    // Address contains location
    if (address.includes(preferred)) return 80;

    // Partial match
    const cityWords = city.split(" ");
    const preferredWords = preferred.split(" ");
    const matchingWords = cityWords.filter((word: string) =>
      preferredWords.some(
        (pWord) => pWord.includes(word) || word.includes(pWord)
      )
    );

    if (matchingWords.length > 0) {
      return (matchingWords.length / preferredWords.length) * 60;
    }

    return 20; // Base score for any property
  }

  /**
   * Calculate amenities satisfaction score
   */
  private calculateAmenityScore(
    propertyAmenities: string[],
    requiredAmenities: string[]
  ): number {
    if (!requiredAmenities || requiredAmenities.length === 0) return 100;

    const availableAmenities = propertyAmenities.map((a) => a.toLowerCase());
    const required = requiredAmenities.map((a) => a.toLowerCase());

    const matchingAmenities = required.filter((amenity) =>
      availableAmenities.some(
        (available) =>
          available.includes(amenity) || amenity.includes(available)
      )
    );

    return (matchingAmenities.length / required.length) * 100;
  }

  /**
   * Calculate size satisfaction score
   */
  private calculateSizeScore(
    property: any,
    constraints: OptimizationConstraints
  ): number {
    // If no size preference, give neutral score
    if (!property.size) return 70;

    // Estimate ideal size based on bedrooms (rough heuristic)
    const idealSize = constraints.bedrooms * 40 + 20; // 40 sqm per bedroom + 20 sqm common
    const sizeDifference = Math.abs(property.size - idealSize);

    // Score decreases with size difference
    const maxDifference = idealSize * 0.5; // 50% tolerance
    const score = Math.max(0, 100 - (sizeDifference / maxDifference) * 100);

    return score;
  }

  /**
   * Calculate feature satisfaction score
   */
  private calculateFeatureScore(
    propertyFeatures: any,
    requiredFeatures?: { [key: string]: boolean }
  ): number {
    if (!requiredFeatures || !propertyFeatures) return 100; // No preferences = perfect score

    let matchCount = 0;
    let totalRequired = 0;

    Object.entries(requiredFeatures).forEach(([feature, required]) => {
      if (required) {
        totalRequired++;
        if (propertyFeatures[feature]) {
          matchCount++;
        }
      }
    });

    return totalRequired === 0 ? 100 : (matchCount / totalRequired) * 100;
  }

  /**
   * Calculate utilities satisfaction score
   */
  private calculateUtilityScore(
    propertyUtilities: any,
    requiredUtilities?: { [key: string]: boolean }
  ): number {
    if (!requiredUtilities || !propertyUtilities) return 100; // No preferences = perfect score

    let matchCount = 0;
    let totalRequired = 0;

    Object.entries(requiredUtilities).forEach(([utility, required]) => {
      if (required) {
        totalRequired++;
        if (propertyUtilities[utility]) {
          matchCount++;
        }
      }
    });

    return totalRequired === 0 ? 100 : (matchCount / totalRequired) * 100;
  }

  /**
   * Generate human-readable explanation for the match
   */
  private generateMatchExplanation(
    property: any,
    constraints: OptimizationConstraints,
    matchScore: number
  ): string[] {
    const explanations: string[] = [];

    // Budget explanation
    const budgetDiff = constraints.budget.max - property.rent;
    if (budgetDiff >= 0) {
      explanations.push(
        `Rent (₦${property.rent.toLocaleString()}) is within your budget, ${
          budgetDiff > 0
            ? `saving you ₦${budgetDiff.toLocaleString()}`
            : "matching your maximum"
        }`
      );
    }

    // Location explanation
    explanations.push(
      `Located in ${property.location.address}, ${property.location.city}`
    );

    // Bedrooms and bathrooms
    explanations.push(
      `${property.bedrooms} bedroom${property.bedrooms > 1 ? "s" : ""}, ${
        property.bathrooms
      } bathroom${property.bathrooms > 1 ? "s" : ""}`
    );

    // Amenities explanation
    if (constraints.amenities && constraints.amenities.length > 0) {
      const matchedAmenities = property.amenities.filter((a: string) =>
        constraints.amenities.includes(a)
      );
      if (matchedAmenities.length > 0) {
        explanations.push(
          `Includes ${
            matchedAmenities.length
          } of your required amenities: ${matchedAmenities.join(", ")}`
        );
      }
    }

    // Features explanation
    if (constraints.features) {
      const matchedFeatures = Object.entries(constraints.features)
        .filter(([feature, required]) => required && property.features[feature])
        .map(([feature]) => feature);
      if (matchedFeatures.length > 0) {
        explanations.push(
          `Matches your feature preferences: ${matchedFeatures
            .map((f) => f.charAt(0).toUpperCase() + f.slice(1))
            .join(", ")}`
        );
      }
    }

    // Utilities explanation
    if (constraints.utilities) {
      const matchedUtilities = Object.entries(constraints.utilities)
        .filter(
          ([utility, required]) => required && property.utilities[utility]
        )
        .map(([utility]) => utility);
      if (matchedUtilities.length > 0) {
        explanations.push(
          `Includes utilities: ${matchedUtilities
            .map((u) => u.charAt(0).toUpperCase() + u.slice(1))
            .join(", ")}`
        );
      }
    }

    // Overall match score
    explanations.push(`Overall match score: ${matchScore.toFixed(0)}%`);

    return explanations;
  }

  /**
   * Validate optimization weights
   */
  private validateWeights(weights: OptimizationWeights): void {
    const sum = Object.values(weights).reduce((acc, weight) => acc + weight, 0);
    const tolerance = 0.01;

    if (Math.abs(sum - 1.0) > tolerance) {
      throw new Error(`Optimization weights must sum to 1.0, got ${sum}`);
    }

    for (const [key, weight] of Object.entries(weights)) {
      if (weight < 0 || weight > 1) {
        throw new Error(
          `Weight for ${key} must be between 0 and 1, got ${weight}`
        );
      }
    }
  }

  /**
   * Get list of constraints satisfied by matches
   */
  private getConstraintsSatisfied(
    matches: PropertyMatch[],
    constraints: OptimizationConstraints
  ): string[] {
    const satisfied: string[] = [];

    if (matches.length > 0) {
      const avgBudgetScore =
        matches.reduce((sum, m) => sum + m.matchDetails.budgetScore, 0) /
        matches.length;
      const avgLocationScore =
        matches.reduce((sum, m) => sum + m.matchDetails.locationScore, 0) /
        matches.length;
      const avgAmenityScore =
        matches.reduce((sum, m) => sum + m.matchDetails.amenityScore, 0) /
        matches.length;
      const avgSizeScore =
        matches.reduce((sum, m) => sum + m.matchDetails.sizeScore, 0) /
        matches.length;

      if (avgBudgetScore >= 70) satisfied.push("budget");
      if (avgLocationScore >= 70) satisfied.push("location");
      if (avgAmenityScore >= 70) satisfied.push("amenities");
      if (avgSizeScore >= 70) satisfied.push("size");

      const avgFeatureScore =
        matches.reduce((sum, m) => sum + m.matchDetails.featureScore, 0) /
        matches.length;
      const avgUtilityScore =
        matches.reduce((sum, m) => sum + m.matchDetails.utilityScore, 0) /
        matches.length;

      if (avgFeatureScore >= 70) satisfied.push("features");
      if (avgUtilityScore >= 70) satisfied.push("utilities");
    }

    return satisfied;
  }

  /**
   * Calculate overall objective value
   */
  private calculateObjectiveValue(
    matches: PropertyMatch[],
    weights: OptimizationWeights
  ): number {
    if (matches.length === 0) return 0;

    const avgScore =
      matches.reduce((sum, match) => sum + match.matchScore, 0) /
      matches.length;
    return avgScore / 100; // Normalize to 0-1 range
  }

  /**
   * Create empty result when no matches found
   */
  private createEmptyResult(
    constraints: OptimizationConstraints,
    weights: OptimizationWeights,
    startTime: number
  ): OptimizationResult {
    return {
      matches: [],
      optimizationDetails: {
        algorithm: "greedy_matching",
        executionTime: Date.now() - startTime,
        constraintsSatisfied: [],
        objectiveValue: 0,
        totalPropertiesEvaluated: 0,
        feasibleSolutions: 0,
      },
      weights,
      constraints,
    };
  }

  /**
   * Linear Programming assignment for tenant-property matching
   *
   * This builds and solves a binary assignment LP to maximize the weighted satisfaction score.
   * Uses 'javascript-lp-solver'.
   */
  private async linearProgrammingAssignment(
    tenantConstraints: OptimizationConstraints,
    properties: any[],
    weights: OptimizationWeights,
    maxResults: number
  ): Promise<PropertyMatch[]> {
    // For this project, we assume a single tenant (from constraints) and many properties.
    // The LP will select up to maxResults properties to maximize total satisfaction.

    // 1. Build variables and scores
    // Each property gets a binary variable: 1 if selected, 0 otherwise
    const variables: Record<string, any> = {}; // key: propertyId, value: variable definition
    const propertyIdList: string[] = [];
    const propertyScoreMap: Record<string, number> = {};
    const propertyDetailsMap: Record<string, any> = {};

    logger.info(`[LP DEBUG] Scoring properties for LP model...`);
    for (const property of properties) {
      const score = this.calculateSatisfactionScore(
        property,
        tenantConstraints,
        weights
      );
      logger.info(`[LP DEBUG] Property ${property._id}: score = ${score}`);
      if (score >= this.minMatchThreshold) {
        const propertyId = property._id.toString();
        propertyIdList.push(propertyId);
        propertyScoreMap[propertyId] = score;
        propertyDetailsMap[propertyId] = {
          budgetScore: this.calculateBudgetScore(property.rent, tenantConstraints.budget),
          locationScore: this.calculateLocationScore(property.location, tenantConstraints.location),
          amenityScore: this.calculateAmenityScore(property.amenities, tenantConstraints.amenities),
          sizeScore: this.calculateSizeScore(property, tenantConstraints),
          featureScore: this.calculateFeatureScore(property.features, tenantConstraints.features),
          utilityScore: this.calculateUtilityScore(property.utilities, tenantConstraints.utilities)
        };
        // Each variable is binary: 1 if property is selected, 0 otherwise
        variables[propertyId] = {
          score,
          maxSelected: 1 // Only one tenant, so each property can be assigned at most once
        };
      }
    }

    logger.info(`[LP DEBUG] Properties included in LP model: ${propertyIdList.length}`);
    if (propertyIdList.length > 0) {
      logger.info(`[LP DEBUG] First propertyId in LP model: ${propertyIdList[0]}, score: ${propertyScoreMap[propertyIdList[0]]}`);
    }

    // 2. Build LP model for javascript-lp-solver
    /**
     * LP Model structure for javascript-lp-solver:
     * {
     *   optimize: "score",
     *   opType: "max",
     *   constraints: { maxSelected: { "max": maxResults } },
     *   variables: {
     *     propertyId1: { score: 87, maxSelected: 1 },
     *     propertyId2: { score: 92, maxSelected: 1 },
     *     ...
     *   },
     *   ints: { propertyId1: 1, propertyId2: 1, ... }
     * }
     */
    const model: any = {
      optimize: "score",
      opType: "max",
      constraints: {
        maxSelected: { max: maxResults },
      },
      variables: {},
      ints: {},
    };

    // Each property variable is binary (0 or 1)
    for (const propertyId of propertyIdList) {
      model.variables[propertyId] = {
        score: propertyScoreMap[propertyId],
        maxSelected: 1, // Used for the sum constraint
      };
      model.ints[propertyId] = 1; // Binary variable
      // Add per-variable constraint: each property can be selected at most once
      model.constraints[propertyId] = { max: 1 };
    }

    logger.info(`[LP DEBUG] LP model constructed:`, JSON.stringify(model, null, 2));

    // 3. Solve LP
    // The solver will select up to maxResults properties to maximize total score
    const results = solver.Solve(model);
    logger.info(`[LP DEBUG] LP solver results:`, results);
    // results[propertyId] = 1 if selected, 0 otherwise

    // 4. Parse results into PropertyMatch[]
    const matches: PropertyMatch[] = [];
    for (const propertyId of propertyIdList) {
      if (results[propertyId] && results[propertyId] >= 0.5) {
        const property = properties.find((p) => p._id.toString() === propertyId);
        if (!property) continue;
        const details = propertyDetailsMap[propertyId];
        matches.push({
          propertyId: property._id,
          tenantId: tenantConstraints.tenantId || 'current-tenant',
          matchScore: Math.round(propertyScoreMap[propertyId]),
          matchDetails: {
            budgetScore: Math.round(details.budgetScore),
            locationScore: Math.round(details.locationScore),
            amenityScore: Math.round(details.amenityScore),
            sizeScore: Math.round(details.sizeScore),
            featureScore: Math.round(details.featureScore),
            utilityScore: Math.round(details.utilityScore),
          },
          explanation: this.generateMatchExplanation(
            property,
            tenantConstraints,
            propertyScoreMap[propertyId]
          ),
          calculatedAt: new Date(),
        });
      }
    }
    return matches;
  }
}

export const linearProgrammingService = LinearProgrammingService.getInstance();