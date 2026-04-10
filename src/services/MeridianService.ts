import { logger } from "@/utils/logger"

/**
 * Meridian — a domain-agnostic market-clearing matching engine.
 *
 * Uses the Hungarian algorithm (Jonker-Volgenant O(n³)) to find the globally
 * optimal bipartite assignment between any two sets of items. The caller
 * supplies the score function — Meridian handles the optimisation.
 *
 * Usage in RentMatch (via RentMatchMeridianService):
 *   meridianService.run(tenants, properties, (t, p) => lpScore(t, p))
 *
 * The same engine can be applied to any other assignment problem:
 *   meridianService.run(riders, orders, proximityScore)
 *   meridianService.run(students, schools, admissionScore)
 */

export interface MeridianAssignment<A, R> {
  agent: A
  resource: R | null   // null if no compatible resource in cohort
  score: number
}

export interface MeridianResult<A, R> {
  assignments: MeridianAssignment<A, R>[]
  globalObjectiveValue: number   // avg score across assigned pairs (0–1)
  executionTimeMs: number
  agentCount: number
  resourceCount: number
}

export class MeridianService {
  private static instance: MeridianService

  public static getInstance(): MeridianService {
    if (!MeridianService.instance) {
      MeridianService.instance = new MeridianService()
    }
    return MeridianService.instance
  }

  /**
   * Run Meridian over two sets and a scoring function.
   *
   * @param agents    — e.g. tenants, riders, students
   * @param resources — e.g. properties, orders, schools
   * @param scoreFn   — returns 0–100 compatibility for (agent, resource)
   * @returns globally optimal one-to-one assignment for each agent
   */
  public async run<A, R>(
    agents: A[],
    resources: R[],
    scoreFn: (agent: A, resource: R) => number
  ): Promise<MeridianResult<A, R>> {
    const startTime = Date.now()
    const n = agents.length
    const m = resources.length

    if (n === 0 || m === 0) {
      return {
        assignments: agents.map((a) => ({ agent: a, resource: null, score: 0 })),
        globalObjectiveValue: 0,
        executionTimeMs: Date.now() - startTime,
        agentCount: n,
        resourceCount: m,
      }
    }

    // Build score matrix [n × m]
    const scoreMatrix: number[][] = agents.map((agent) =>
      resources.map((resource) => scoreFn(agent, resource))
    )

    // Solve via Hungarian algorithm (maximisation → minimisation via inversion)
    const size = Math.max(n, m)
    const assignment = this.hungarian(scoreMatrix, n, m, size)

    // Map results
    const assignments: MeridianAssignment<A, R>[] = agents.map((agent, i) => {
      const j = assignment[i]
      if (j >= 0 && j < m) {
        return { agent, resource: resources[j], score: scoreMatrix[i][j] }
      }
      return { agent, resource: null, score: 0 }
    })

    // Global objective: avg score across assigned pairs (0–1 scale)
    const assigned = assignments.filter((a) => a.resource !== null)
    const globalObjectiveValue = assigned.length > 0
      ? assigned.reduce((s, a) => s + a.score, 0) / (assigned.length * 100)
      : 0

    const execMs = Date.now() - startTime
    logger.info(
      `[Meridian] n=${n} m=${m} assigned=${assigned.length} global=${globalObjectiveValue.toFixed(2)} time=${execMs}ms`
    )

    return {
      assignments,
      globalObjectiveValue: Math.round(globalObjectiveValue * 100) / 100,
      executionTimeMs: execMs,
      agentCount: n,
      resourceCount: m,
    }
  }

  /**
   * Hungarian algorithm — Jonker-Volgenant potential method.
   * Time complexity: O(n³). Safe up to ~500×500 matrices in <100ms.
   *
   * Converts maximisation to minimisation: cost(i,j) = 100 - score(i,j)
   * Padding rows/cols use cost=100 to handle non-square matrices gracefully.
   */
  public hungarian(
    scoreMatrix: number[][],
    n: number,
    m: number,
    size: number
  ): number[] {
    const INF = 1e9

    const cost = (i: number, j: number): number =>
      i < n && j < m ? 100 - scoreMatrix[i][j] : 100

    const u = new Array(size + 1).fill(0)
    const v = new Array(size + 1).fill(0)
    const p = new Array(size + 1).fill(0)
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

    const assignment = new Array(size).fill(-1)
    for (let j = 1; j <= size; j++) {
      if (p[j] !== 0) assignment[p[j] - 1] = j - 1
    }
    return assignment
  }
}

export const meridianService = MeridianService.getInstance()
