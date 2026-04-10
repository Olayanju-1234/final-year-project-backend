import { meridianService } from "./MeridianService"
import { linearProgrammingService } from "./LinearProgrammingService"
import { Tenant } from "@/models/Tenant"
import { Property } from "@/models/Property"
import { logger } from "@/utils/logger"
import type { PropertyMatch, OptimizationConstraints } from "@/types"

/**
 * RentMatchMeridianService
 *
 * Thin adapter that wires the RentMatch domain (tenants, properties, LP scores)
 * into the domain-agnostic Meridian engine.
 *
 * Meridian itself has no knowledge of tenants or properties — it only sees:
 *   agents[]   → resources[]   → scoreFn(agent, resource) → 0–100
 *
 * This service is responsible for:
 *   1. Scoping the cohort (matching budget range + city overlap)
 *   2. Providing the LP score function
 *   3. Translating Meridian's output back into PropertyMatch objects
 */

export interface RentMatchMeridianResult {
  assignedProperty: PropertyMatch | null
  alternatives: PropertyMatch[]
  marketStats: {
    cohortSize: number
    propertiesEvaluated: number
    globalObjectiveValue: number
    yourObjectiveValue: number
    executionTimeMs: number
    algorithm: "meridian"
  }
}

export class RentMatchMeridianService {
  private static instance: RentMatchMeridianService

  public static getInstance(): RentMatchMeridianService {
    if (!RentMatchMeridianService.instance) {
      RentMatchMeridianService.instance = new RentMatchMeridianService()
    }
    return RentMatchMeridianService.instance
  }

  public async run(tenantId: string): Promise<RentMatchMeridianResult> {
    const startTime = Date.now()

    const requestingTenant = await Tenant.findById(tenantId).populate("userId", "name").lean()
    if (!requestingTenant) throw new Error("Tenant not found")

    const prefs = requestingTenant.preferences
    const weights = linearProgrammingService.getDefaultWeights()

    // --- Cohort scoping ---
    // Tenants whose budget overlaps AND preferred location overlaps
    const cohortTenants: any[] = await Tenant.find({
      $and: [
        { "preferences.budget.max": { $gte: prefs.budget.min } },
        { "preferences.budget.min": { $lte: prefs.budget.max } },
        { "preferences.preferredLocation": new RegExp(prefs.preferredLocation, "i") },
      ],
    })
      .populate("userId", "name")
      .lean()

    if (!cohortTenants.some((t) => t._id.toString() === tenantId)) {
      cohortTenants.push(requestingTenant as any)
    }

    // Properties: available in city, rent within ±30% of tenant budget
    const cityPattern = new RegExp(prefs.preferredLocation, "i")
    const properties: any[] = await Property.find({
      status: "available",
      $or: [{ "location.city": cityPattern }, { "location.address": cityPattern }],
      rent: { $gte: prefs.budget.min * 0.7, $lte: prefs.budget.max * 1.3 },
    })
      .limit(200)
      .lean()

    logger.info(
      `[RentMatchMeridian] tenant=${tenantId} cohort=${cohortTenants.length} properties=${properties.length}`
    )

    if (properties.length === 0) {
      return this.emptyResult(startTime, cohortTenants.length)
    }

    // --- Score function: LP compatibility (0–100) ---
    const scoreFn = (tenant: any, property: any): number => {
      const constraints = this.tenantToConstraints(tenant)
      return linearProgrammingService.scoreProperty(property, constraints, weights)
    }

    // Run Meridian — fully generic, knows nothing about tenants or properties
    const result = await meridianService.run(cohortTenants, properties, scoreFn)

    // --- Translate result back to PropertyMatch ---
    const requestingIdx = cohortTenants.findIndex((t) => t._id.toString() === tenantId)
    const myAssignment = result.assignments[requestingIdx]
    const requestingConstraints = this.tenantToConstraints(requestingTenant as any)

    let assignedMatch: PropertyMatch | null = null
    if (myAssignment?.resource) {
      const prop = myAssignment.resource
      assignedMatch = {
        propertyId: prop._id,
        tenantId: tenantId as any,
        matchScore: Math.round(myAssignment.score),
        matchDetails: linearProgrammingService.getMatchDetails(prop, requestingConstraints, weights),
        explanation: linearProgrammingService.explainMatch(prop, requestingConstraints, myAssignment.score),
        calculatedAt: new Date(),
      }
    }

    // LP alternatives for this tenant (top-5 excluding the assigned property)
    const assignedPropId = myAssignment?.resource?._id?.toString()
    const alternatives: PropertyMatch[] = properties
      .map((prop) => ({
        prop,
        score: linearProgrammingService.scoreProperty(prop, requestingConstraints, weights),
      }))
      .filter(({ prop, score }) => prop._id.toString() !== assignedPropId && score >= 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ prop, score }) => ({
        propertyId: prop._id,
        tenantId: tenantId as any,
        matchScore: Math.round(score),
        matchDetails: linearProgrammingService.getMatchDetails(prop, requestingConstraints, weights),
        explanation: linearProgrammingService.explainMatch(prop, requestingConstraints, score),
        calculatedAt: new Date(),
      }))

    return {
      assignedProperty: assignedMatch,
      alternatives,
      marketStats: {
        cohortSize: cohortTenants.length,
        propertiesEvaluated: properties.length,
        globalObjectiveValue: result.globalObjectiveValue,
        yourObjectiveValue: assignedMatch ? Math.round(assignedMatch.matchScore) / 100 : 0,
        executionTimeMs: Date.now() - startTime,
        algorithm: "meridian",
      },
    }
  }

  private tenantToConstraints(tenant: any): OptimizationConstraints {
    const prefs = tenant.preferences
    return {
      tenantId: tenant._id.toString(),
      budget: prefs.budget,
      location: prefs.preferredLocation,
      amenities: prefs.requiredAmenities || [],
      bedrooms: prefs.preferredBedrooms,
      bathrooms: prefs.preferredBathrooms,
      features: prefs.features,
      utilities: prefs.utilities,
    }
  }

  private emptyResult(startTime: number, cohortSize: number): RentMatchMeridianResult {
    return {
      assignedProperty: null,
      alternatives: [],
      marketStats: {
        cohortSize,
        propertiesEvaluated: 0,
        globalObjectiveValue: 0,
        yourObjectiveValue: 0,
        executionTimeMs: Date.now() - startTime,
        algorithm: "meridian",
      },
    }
  }
}

export const rentMatchMeridianService = RentMatchMeridianService.getInstance()
