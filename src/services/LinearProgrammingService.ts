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
    features: Number.parseFloat(process.env.LP_DEFAULT_WEIGHTS_FEATURES || "0.15"),
    utilities: Number.parseFloat(process.env.LP_DEFAULT_WEIGHTS_UTILITIES || "0.1"),
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
   */
  public async optimizeMatching(
    constraints: OptimizationConstraints,
    weights: Partial<OptimizationWeights> = {},
    maxResults = 10
  ): Promise<OptimizationResult> {
    const startTime = Date.now();

    try {
      logger.info("Starting Linear Programming optimization", {
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

      if (properties.length === 0) {
        return this.createEmptyResult(constraints, finalWeights, startTime);
      }

      // Build constraint matrix and objective function
      const { constraintMatrix, objectiveVector, propertyIds } =
        this.buildLinearProgrammingModel(properties, constraints, finalWeights);

      // Solve the linear programming problem
      const solution = this.solveLPProblem(constraintMatrix, objectiveVector);

      // Convert solution to property matches
      const matches = this.convertSolutionToMatches(
        solution,
        properties,
        propertyIds,
        constraints,
        finalWeights,
        maxResults
      );

      const executionTime = Date.now() - startTime;

      logger.info("Linear Programming optimization completed", {
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
      logger.error("Linear Programming optimization failed", error);
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
    const tenants = await Tenant.find({ 'preferences.budget': { $exists: true } }).populate('userId', 'name').lean();

    if (tenants.length === 0) {
      return { matches: [], optimizationDetails: { executionTime: Date.now() - startTime, matchesFound: 0 } };
    }

    const tenantScores = tenants.map(tenant => {
      const constraints: OptimizationConstraints = {
        budget: tenant.preferences.budget,
        location: tenant.preferences.preferredLocation,
        amenities: tenant.preferences.requiredAmenities,
        bedrooms: tenant.preferences.preferredBedrooms,
        bathrooms: tenant.preferences.preferredBathrooms,
        features: tenant.preferences.features,
        utilities: tenant.preferences.utilities,
      };
      
      const score = this.calculateSatisfactionScore(property, constraints, this.defaultWeights);
      
      return {
        tenant: {
          _id: tenant._id,
          name: (tenant.userId as any)?.name || 'N/A',
        },
        matchScore: Math.round(score),
        preferencesSummary: `Budget: ₦${tenant.preferences.budget.min}-₦${tenant.preferences.budget.max}, Location: ${tenant.preferences.preferredLocation}`,
      };
    });

    const matches = tenantScores
      .filter(match => match.matchScore >= this.minMatchThreshold)
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

    // Note: Features and utilities are now handled as soft constraints in the scoring phase
    // rather than hard filters here

    const maxProperties = Number.parseInt(
      process.env.MAX_PROPERTIES_PER_OPTIMIZATION || "100"
    );

    return await Property.find(query).limit(maxProperties).lean().exec();
  }

  /**
   * Build the Linear Programming model matrices
   */
  private buildLinearProgrammingModel(
    properties: any[],
    constraints: OptimizationConstraints,
    weights: OptimizationWeights
  ) {
    const numProperties = properties.length;
    const propertyIds = properties.map((p) => p._id.toString());

    // Build objective function coefficients (maximize satisfaction)
    const objectiveVector = new Array(numProperties);

    for (let i = 0; i < numProperties; i++) {
      const property = properties[i];
      const satisfactionScore = this.calculateSatisfactionScore(
        property,
        constraints,
        weights
      );
      objectiveVector[i] = satisfactionScore;
    }

    // Build constraint matrix
    // For this implementation, we use a simplified approach
    // In a full LP solver, you would have inequality constraints
    const constraintMatrix = this.buildConstraintMatrix(
      properties,
      constraints
    );

    return {
      constraintMatrix,
      objectiveVector,
      propertyIds,
    };
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
    if (rent < budget.min || rent > budget.max) return 0;

    // Higher score for rent closer to minimum (better value)
    const range = budget.max - budget.min;
    if (range === 0) return 100;

    const position = (budget.max - rent) / range;
    return position * 100;
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
   * Build constraint matrix for LP problem
   */
  private buildConstraintMatrix(
    properties: any[],
    constraints: OptimizationConstraints
  ): Matrix {
    const numProperties = properties.length;
    const numConstraints = 6; // budget, location, amenities, size, features, utilities

    const matrix = new Array(numConstraints);
    for (let i = 0; i < numConstraints; i++) {
      matrix[i] = new Array(numProperties).fill(0);
    }

    for (let j = 0; j < numProperties; j++) {
      const property = properties[j];

      // Budget constraint (1 if within budget, 0 otherwise)
      matrix[0][j] =
        property.rent >= constraints.budget.min &&
        property.rent <= constraints.budget.max
          ? 1
          : 0;

      // Location constraint (1 if matches, 0 otherwise)
      matrix[1][j] =
        this.calculateLocationScore(property.location, constraints.location) >
        30
          ? 1
          : 0;

      // Amenities constraint (1 if has required amenities, 0 otherwise)
      matrix[2][j] =
        this.calculateAmenityScore(property.amenities, constraints.amenities) >
        50
          ? 1
          : 0;

      // Size constraint (1 if reasonable size, 0 otherwise)
      matrix[3][j] =
        this.calculateSizeScore(property, constraints) > 30 ? 1 : 0;

      // Features constraint (1 if matches some features, 0 otherwise)
      matrix[4][j] =
        this.calculateFeatureScore(property.features, constraints.features) >
        30
          ? 1
          : 0;

      // Utilities constraint (1 if matches some utilities, 0 otherwise)
      matrix[5][j] =
        this.calculateUtilityScore(property.utilities, constraints.utilities) >
        30
          ? 1
          : 0;
    }

    return new Matrix(matrix);
  }

  /**
   * Solve the Linear Programming problem
   * This is a simplified implementation. In production, you might use
   * a dedicated LP solver like GLPK or similar
   */
  private solveLPProblem(
    constraintMatrix: Matrix,
    objectiveVector: number[]
  ): number[] {
    // Simplified greedy approach that respects constraints
    // In a full implementation, you would use simplex method or interior point method

    const numProperties = objectiveVector.length;
    const solution = new Array(numProperties).fill(0);

    // Create property-score pairs and sort by objective value
    const propertyScores = objectiveVector.map((score, index) => ({
      index,
      score,
      feasible: this.checkFeasibility(constraintMatrix, index),
    }));

    // Sort by score (descending) and feasibility
    propertyScores.sort((a, b) => {
      if (a.feasible && !b.feasible) return -1;
      if (!a.feasible && b.feasible) return 1;
      return b.score - a.score;
    });

    // Select top properties that meet constraints
    let selectedCount = 0;
    const maxSelections = Math.min(10, numProperties); // Limit selections

    for (const item of propertyScores) {
      if (selectedCount >= maxSelections) break;
      if (item.feasible && item.score >= this.minMatchThreshold) {
        solution[item.index] = 1;
        selectedCount++;
      }
    }

    return solution;
  }

  /**
   * Check if a property satisfies all constraints
   */
  private checkFeasibility(
    constraintMatrix: Matrix,
    propertyIndex: number
  ): boolean {
    const numConstraints = constraintMatrix.rows;
    let satisfiedCount = 0;

    for (let i = 0; i < numConstraints; i++) {
      if (constraintMatrix.get(i, propertyIndex) === 1) {
        satisfiedCount++;
      }
    }

    // Property is feasible if it satisfies at least 4 out of 6 constraints
    return satisfiedCount >= 4;
  }

  /**
   * Convert LP solution to property matches
   */
  private convertSolutionToMatches(
    solution: number[],
    properties: any[],
    propertyIds: string[],
    constraints: OptimizationConstraints,
    weights: OptimizationWeights,
    maxResults: number
  ): PropertyMatch[] {
    const matches: PropertyMatch[] = [];

    for (let i = 0; i < solution.length; i++) {
      if (solution[i] > 0) {
        // Property is selected
        const property = properties[i];
        const matchScore = this.calculateSatisfactionScore(
          property,
          constraints,
          weights
        );

        if (matchScore >= this.minMatchThreshold) {
          const match: PropertyMatch = {
            propertyId: property._id,
            tenantId: constraints.tenantId,
            matchScore: Math.round(matchScore),
            matchDetails: {
              budgetScore: Math.round(
                this.calculateBudgetScore(property.rent, constraints.budget)
              ),
              locationScore: Math.round(
                this.calculateLocationScore(
                  property.location,
                  constraints.location
                )
              ),
              amenityScore: Math.round(
                this.calculateAmenityScore(
                  property.amenities,
                  constraints.amenities
                )
              ),
              sizeScore: Math.round(
                this.calculateSizeScore(property, constraints)
              ),
              featureScore: Math.round(
                this.calculateFeatureScore(
                  property.features,
                  constraints.features
                )
              ),
              utilityScore: Math.round(
                this.calculateUtilityScore(
                  property.utilities,
                  constraints.utilities
                )
              ),
            },
            explanation: this.generateMatchExplanation(
              property,
              constraints,
              matchScore
            ),
            calculatedAt: new Date(),
          };

          matches.push(match);
        }
      }
    }

    // Sort by match score and limit results
    return matches
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, maxResults);
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
          budgetDiff > 0 ? `saving you ₦${budgetDiff.toLocaleString()}` : "matching your maximum"
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
          `Includes ${matchedAmenities.length} of your required amenities: ${matchedAmenities.join(
            ", "
          )}`
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
        .filter(([utility, required]) => required && property.utilities[utility])
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
        algorithm: "linear_programming",
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
}

export const linearProgrammingService = LinearProgrammingService.getInstance();
