import { Matrix } from "ml-matrix";
import { Property } from "@/models/Property";
import type {
  OptimizationConstraints,
  OptimizationWeights,
  OptimizationResult,
  PropertyMatch,
} from "@/types";
import { logger } from "@/utils/logger";

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
    budget: Number.parseFloat(process.env.LP_DEFAULT_WEIGHTS_BUDGET || "0.3"),
    location: Number.parseFloat(
      process.env.LP_DEFAULT_WEIGHTS_LOCATION || "0.25"
    ),
    amenities: Number.parseFloat(
      process.env.LP_DEFAULT_WEIGHTS_AMENITIES || "0.25"
    ),
    size: Number.parseFloat(process.env.LP_DEFAULT_WEIGHTS_SIZE || "0.2"),
  };

  private readonly maxExecutionTime = Number.parseInt(
    process.env.LP_MAX_EXECUTION_TIME || "30000"
  );
  private readonly minMatchThreshold = Number.parseInt(
    process.env.MIN_MATCH_SCORE_THRESHOLD || "60"
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

    // Weighted combination
    const totalScore =
      weights.budget * budgetScore +
      weights.location * locationScore +
      weights.amenities * amenityScore +
      weights.size * sizeScore;

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
   * Build constraint matrix for LP problem
   */
  private buildConstraintMatrix(
    properties: any[],
    constraints: OptimizationConstraints
  ): Matrix {
    const numProperties = properties.length;
    const numConstraints = 4; // budget, location, amenities, size

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
        50
          ? 1
          : 0;

      // Amenities constraint (1 if has required amenities, 0 otherwise)
      matrix[2][j] =
        this.calculateAmenityScore(property.amenities, constraints.amenities) >
        70
          ? 1
          : 0;

      // Size constraint (1 if reasonable size, 0 otherwise)
      matrix[3][j] =
        this.calculateSizeScore(property, constraints) > 50 ? 1 : 0;
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

    for (let i = 0; i < numConstraints; i++) {
      if (constraintMatrix.get(i, propertyIndex) === 0) {
        return false; // Constraint not satisfied
      }
    }

    return true;
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
    const budgetScore = this.calculateBudgetScore(
      property.rent,
      constraints.budget
    );
    if (budgetScore >= 80) {
      explanations.push(
        `Excellent budget match (₦${property.rent.toLocaleString()} vs ₦${constraints.budget.max.toLocaleString()} max)`
      );
    } else if (budgetScore >= 60) {
      explanations.push(
        `Good budget fit (₦${property.rent.toLocaleString()} within your range)`
      );
    } else if (budgetScore > 0) {
      explanations.push(`Within budget (₦${property.rent.toLocaleString()})`);
    }

    // Location explanation
    const locationScore = this.calculateLocationScore(
      property.location,
      constraints.location
    );
    if (locationScore >= 90) {
      explanations.push(`Perfect location match: ${property.location.city}`);
    } else if (locationScore >= 70) {
      explanations.push(`Great location in ${property.location.city}`);
    } else if (locationScore >= 50) {
      explanations.push(`Good location accessibility`);
    }

    // Amenities explanation
    const amenityScore = this.calculateAmenityScore(
      property.amenities,
      constraints.amenities
    );
    if (amenityScore >= 90) {
      explanations.push(`All requested amenities available`);
    } else if (amenityScore >= 70) {
      explanations.push(`Most requested amenities included`);
    } else if (amenityScore >= 50) {
      explanations.push(`Essential amenities covered`);
    }

    // Size explanation
    if (property.size) {
      explanations.push(
        `${property.size} sqm - suitable for ${constraints.bedrooms} bedroom needs`
      );
    }

    // Overall score explanation
    if (matchScore >= 90) {
      explanations.push(
        `Outstanding overall match (${matchScore}% compatibility)`
      );
    } else if (matchScore >= 80) {
      explanations.push(`Excellent match (${matchScore}% compatibility)`);
    } else if (matchScore >= 70) {
      explanations.push(`Good match (${matchScore}% compatibility)`);
    }

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
