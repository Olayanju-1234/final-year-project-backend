import { linearProgrammingService } from "./LinearProgrammingService"
import { Tenant } from "@/models/Tenant"
import { Property } from "@/models/Property"
import { logger } from "@/utils/logger"
import type { PropertyMatch, OptimizationConstraints } from "@/types"

export interface MeridianResult {
  assignedProperty: PropertyMatch | null
  alternatives: PropertyMatch[]
  marketStats: {
    cohortSize: number
    propertiesEvaluated: number
    globalObjectiveValue: number
    yourObjectiveValue: number
    executionTime: number
    algorithm: "meridian"
  }
}

/**
 * Meridian — RentMatch's market-clearing matching engine.
 *
 * Unlike per-tenant LP matching (greedy, locally optimal), Meridian solves
 * the entire active cohort as a bipartite assignment problem using the
 * Hungarian algorithm. This finds the globally optimal assignment that
 * maximises total compatibility across all tenants in the same market segment.
 *
 * Named after the meridian — the highest point — reflecting that the engine
 * finds the global optimum rather than any local maximum.
 */
export class MeridianService {
  private static instance: MeridianService

  public static getInstance(): MeridianService {
    if (!MeridianService.instance) {
      MeridianService.instance = new MeridianService()
    }
    return MeridianService.instance
  }

  public async run(tenantId: string): Promise<MeridianResult> {
    const startTime = Date.now()

    const requestingTenant = await Tenant.findById(tenantId).populate("userId", "name").lean()
    if (!requestingTenant) throw new Error("Tenant not found")

    const prefs = requestingTenant.preferences

    // Cohort: tenants whose budget range overlaps AND preferred location matches
    const cohortTenants: any[] = await Tenant.find({
      $and: [
        { "preferences.budget.max": { $gte: prefs.budget.min } },
        { "preferences.budget.min": { $lte: prefs.budget.max } },
        { "preferences.preferredLocation": new RegExp(prefs.preferredLocation, "i") },
      ],
    })
      .populate("userId", "name")
      .lean()

    // Ensure requesting tenant is always in cohort
    const inCohort = cohortTenants.some((t) => t._id.toString() === tenantId)
    if (!inCohort) cohortTenants.push(requestingTenant as any)

    logger.info(`[Meridian] tenant=${tenantId} cohort=${cohortTenants.length}`)

    // Properties: available, matching city, budget within ±30%
    const cityPattern = new RegExp(prefs.preferredLocation, "i")
    const properties: any[] = await Property.find({
      status: "available",
      $or: [{ "location.city": cityPattern }, { "location.address": cityPattern }],
      rent: { $gte: prefs.budget.min * 0.7, $lte: prefs.budget.max * 1.3 },
    })
      .limit(200)
      .lean()

    logger.info(`[Meridian] properties in market=${properties.length}`)

    if (properties.length === 0 || cohortTenants.length === 0) {
      return this.emptyResult(startTime)
    }

    const weights = linearProgrammingService.getDefaultWeights()
    const n = cohortTenants.length
    const m = properties.length

    // Build score matrix [n × m]
    const scoreMatrix: number[][] = cohortTenants.map((tenant) => {
      const constraints = this.tenantToConstraints(tenant)
      return properties.map((property) =>
        linearProgrammingService.scoreProperty(property, constraints, weights)
      )
    })

    // Hungarian algorithm (maximisation via inversion)
    const size = Math.max(n, m)
    const assignment = this.hungarian(scoreMatrix, n, m, size)

    // Extract this tenant's assignment
    const requestingIdx = cohortTenants.findIndex((t) => t._id.toString() === tenantId)
    const assignedPropertyIdx = requestingIdx !== -1 ? assignment[requestingIdx] : -1
    const assignedPropertyRaw =
      assignedPropertyIdx >= 0 && assignedPropertyIdx < m ? properties[assignedPropertyIdx] : null

    const requestingConstraints = this.tenantToConstraints(requestingTenant as any)
    let assignedMatch: PropertyMatch | null = null

    if (assignedPropertyRaw) {
      const score = linearProgrammingService.scoreProperty(
        assignedPropertyRaw,
        requestingConstraints,
        weights
      )
      assignedMatch = {
        propertyId: assignedPropertyRaw._id,
        tenantId: tenantId as any,
        matchScore: Math.round(score),
        matchDetails: linearProgrammingService.getMatchDetails(
          assignedPropertyRaw,
          requestingConstraints,
          weights
        ),
        explanation: linearProgrammingService.explainMatch(
          assignedPropertyRaw,
          requestingConstraints,
          score
        ),
        calculatedAt: new Date(),
      }
    }

    // LP alternatives for this tenant (top-5 excluding assigned)
    const tenantScores = properties
      .map((p, i) => ({ property: p, score: scoreMatrix[requestingIdx]?.[i] ?? 0, idx: i }))
      .filter((x) => x.score >= 30 && x.idx !== assignedPropertyIdx)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    const alternatives: PropertyMatch[] = tenantScores.map(({ property, score }) => ({
      propertyId: property._id,
      tenantId: tenantId as any,
      matchScore: Math.round(score),
      matchDetails: linearProgrammingService.getMatchDetails(property, requestingConstraints, weights),
      explanation: linearProgrammingService.explainMatch(property, requestingConstraints, score),
      calculatedAt: new Date(),
    }))

    // Global objective value (avg compatibility across all assignments)
    let globalSum = 0
    let assignedCount = 0
    for (let i = 0; i < n; i++) {
      const j = assignment[i]
      if (j >= 0 && j < m) {
        globalSum += scoreMatrix[i][j]
        assignedCount++
      }
    }
    const globalObjectiveValue = assignedCount > 0 ? globalSum / (assignedCount * 100) : 0
    const yourObjectiveValue = assignedMatch ? assignedMatch.matchScore / 100 : 0

    logger.info(
      `[Meridian] done in ${Date.now() - startTime}ms global=${globalObjectiveValue.toFixed(2)} tenant=${yourObjectiveValue.toFixed(2)}`
    )

    return {
      assignedProperty: assignedMatch,
      alternatives,
      marketStats: {
        cohortSize: cohortTenants.length,
        propertiesEvaluated: properties.length,
        globalObjectiveValue: Math.round(globalObjectiveValue * 100) / 100,
        yourObjectiveValue: Math.round(yourObjectiveValue * 100) / 100,
        executionTime: Date.now() - startTime,
        algorithm: "meridian",
      },
    }
  }

  /**
   * Hungarian algorithm — O(n³) implementation using Jonker-Volgenant potentials.
   * Converts maximisation to minimisation by inverting scores (cost = 100 - score).
   */
  private hungarian(
    scoreMatrix: number[][],
    n: number,
    m: number,
    size: number
  ): number[] {
    const INF = 1e9

    // cost[i][j] = 100 - scoreMatrix[i][j]; padding rows/cols use cost=100 (neutral)
    const cost = (i: number, j: number): number => {
      if (i < n && j < m) return 100 - scoreMatrix[i][j]
      return 100
    }

    const u = new Array(size + 1).fill(0)   // row potentials
    const v = new Array(size + 1).fill(0)   // col potentials
    const p = new Array(size + 1).fill(0)   // p[j] = row assigned to col j (1-indexed)
    const way = new Array(size + 1).fill(0)

    for (let i = 1; i <= size; i++) {
      p[0] = i
      let j0 = 0
      const minVal = new Array(size + 1).fill(INF)
      const used = new Array(size + 1).fill(false)

      do {
        used[j0] = true
        const i0 = p[j0]
        let delta = INF
        let j1 = -1

        for (let j = 1; j <= size; j++) {
          if (!used[j]) {
            const cur = cost(i0 - 1, j - 1) - u[i0] - v[j]
            if (cur < minVal[j]) {
              minVal[j] = cur
              way[j] = j0
            }
            if (minVal[j] < delta) {
              delta = minVal[j]
              j1 = j
            }
          }
        }

        for (let j = 0; j <= size; j++) {
          if (used[j]) {
            u[p[j]] += delta
            v[j] -= delta
          } else {
            minVal[j] -= delta
          }
        }

        j0 = j1!
      } while (p[j0] !== 0)

      do {
        p[j0] = p[way[j0]]
        j0 = way[j0]
      } while (j0)
    }

    // assignment[i] = j means row i (tenant) → col j (property), both 0-indexed
    const assignment = new Array(size).fill(-1)
    for (let j = 1; j <= size; j++) {
      if (p[j] !== 0) {
        assignment[p[j] - 1] = j - 1
      }
    }

    return assignment
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

  private emptyResult(startTime: number): MeridianResult {
    return {
      assignedProperty: null,
      alternatives: [],
      marketStats: {
        cohortSize: 0,
        propertiesEvaluated: 0,
        globalObjectiveValue: 0,
        yourObjectiveValue: 0,
        executionTime: Date.now() - startTime,
        algorithm: "meridian",
      },
    }
  }
}

export const meridianService = MeridianService.getInstance()
