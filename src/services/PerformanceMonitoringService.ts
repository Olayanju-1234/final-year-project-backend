import { logger } from "@/utils/logger";

interface PerformanceMetrics {
  executionTime: number;
  memoryUsage: number;
  cpuUsage: number;
  algorithm: string;
  constraintsCount: number;
  propertiesEvaluated: number;
  matchesFound: number;
  objectiveValue: number;
  timestamp: Date;
  success: boolean;
  error?: string;
}

interface AlgorithmPerformance {
  algorithm: string;
  averageExecutionTime: number;
  successRate: number;
  averageObjectiveValue: number;
  totalRuns: number;
  lastRun: Date;
}

export class PerformanceMonitoringService {
  private static instance: PerformanceMonitoringService;
  private metrics: PerformanceMetrics[] = [];
  private readonly maxMetricsHistory = 1000;

  public static getInstance(): PerformanceMonitoringService {
    if (!PerformanceMonitoringService.instance) {
      PerformanceMonitoringService.instance = new PerformanceMonitoringService();
    }
    return PerformanceMonitoringService.instance;
  }

  /**
   * Record performance metrics for an optimization run
   */
  public recordMetrics(metrics: Omit<PerformanceMetrics, 'timestamp'>): void {
    const fullMetrics: PerformanceMetrics = {
      ...metrics,
      timestamp: new Date(),
    };

    this.metrics.push(fullMetrics);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }

    logger.info("Performance metrics recorded", {
      algorithm: metrics.algorithm,
      executionTime: metrics.executionTime,
      success: metrics.success,
    });
  }

  /**
   * Get performance statistics for a specific algorithm
   */
  public getAlgorithmPerformance(algorithm: string): AlgorithmPerformance {
    const algorithmMetrics = this.metrics.filter(m => m.algorithm === algorithm);
    
    if (algorithmMetrics.length === 0) {
      return {
        algorithm,
        averageExecutionTime: 0,
        successRate: 0,
        averageObjectiveValue: 0,
        totalRuns: 0,
        lastRun: new Date(0),
      };
    }

    const successfulRuns = algorithmMetrics.filter(m => m.success);
    const totalRuns = algorithmMetrics.length;
    const successRate = (successfulRuns.length / totalRuns) * 100;

    const averageExecutionTime = successfulRuns.reduce((sum, m) => sum + m.executionTime, 0) / successfulRuns.length;
    const averageObjectiveValue = successfulRuns.reduce((sum, m) => sum + m.objectiveValue, 0) / successfulRuns.length;
    const lastRun = algorithmMetrics[algorithmMetrics.length - 1].timestamp;

    return {
      algorithm,
      averageExecutionTime,
      successRate,
      averageObjectiveValue,
      totalRuns,
      lastRun,
    };
  }

  /**
   * Get overall performance statistics
   */
  public getOverallPerformance(): {
    totalOptimizations: number;
    averageExecutionTime: number;
    successRate: number;
    algorithmBreakdown: AlgorithmPerformance[];
  } {
    const totalOptimizations = this.metrics.length;
    const successfulRuns = this.metrics.filter(m => m.success);
    const successRate = totalOptimizations > 0 ? (successfulRuns.length / totalOptimizations) * 100 : 0;
    const averageExecutionTime = successfulRuns.length > 0 
      ? successfulRuns.reduce((sum, m) => sum + m.executionTime, 0) / successfulRuns.length 
      : 0;

    // Get unique algorithms
    const algorithms = [...new Set(this.metrics.map(m => m.algorithm))];
    const algorithmBreakdown = algorithms.map(alg => this.getAlgorithmPerformance(alg));

    return {
      totalOptimizations,
      averageExecutionTime,
      successRate,
      algorithmBreakdown,
    };
  }

  /**
   * Get performance trends over time
   */
  public getPerformanceTrends(days: number = 7): {
    date: string;
    optimizations: number;
    averageExecutionTime: number;
    successRate: number;
  }[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const recentMetrics = this.metrics.filter(m => m.timestamp >= cutoffDate);
    const dailyStats = new Map<string, PerformanceMetrics[]>();

    // Group metrics by date
    recentMetrics.forEach(metric => {
      const dateKey = metric.timestamp.toISOString().split('T')[0];
      if (!dailyStats.has(dateKey)) {
        dailyStats.set(dateKey, []);
      }
      dailyStats.get(dateKey)!.push(metric);
    });

    // Calculate daily statistics
    const trends = Array.from(dailyStats.entries()).map(([date, metrics]) => {
      const successfulRuns = metrics.filter(m => m.success);
      const successRate = metrics.length > 0 ? (successfulRuns.length / metrics.length) * 100 : 0;
      const averageExecutionTime = successfulRuns.length > 0 
        ? successfulRuns.reduce((sum, m) => sum + m.executionTime, 0) / successfulRuns.length 
        : 0;

      return {
        date,
        optimizations: metrics.length,
        averageExecutionTime,
        successRate,
      };
    });

    return trends.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get memory usage statistics
   */
  public getMemoryUsageStats(): {
    averageMemoryUsage: number;
    peakMemoryUsage: number;
    memoryTrend: number; // percentage change
  } {
    const successfulRuns = this.metrics.filter(m => m.success && m.memoryUsage > 0);
    
    if (successfulRuns.length === 0) {
      return {
        averageMemoryUsage: 0,
        peakMemoryUsage: 0,
        memoryTrend: 0,
      };
    }

    const averageMemoryUsage = successfulRuns.reduce((sum, m) => sum + m.memoryUsage, 0) / successfulRuns.length;
    const peakMemoryUsage = Math.max(...successfulRuns.map(m => m.memoryUsage));

    // Calculate trend (comparing first half vs second half)
    const midPoint = Math.floor(successfulRuns.length / 2);
    const firstHalf = successfulRuns.slice(0, midPoint);
    const secondHalf = successfulRuns.slice(midPoint);

    const firstHalfAvg = firstHalf.reduce((sum, m) => sum + m.memoryUsage, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, m) => sum + m.memoryUsage, 0) / secondHalf.length;

    const memoryTrend = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0;

    return {
      averageMemoryUsage,
      peakMemoryUsage,
      memoryTrend,
    };
  }

  /**
   * Clear old metrics
   */
  public clearOldMetrics(daysToKeep: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const initialCount = this.metrics.length;
    this.metrics = this.metrics.filter(m => m.timestamp >= cutoffDate);
    const removedCount = initialCount - this.metrics.length;

    logger.info("Cleared old performance metrics", {
      removedCount,
      remainingCount: this.metrics.length,
    });
  }

  /**
   * Export metrics for analysis
   */
  public exportMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get optimization efficiency score
   */
  public getEfficiencyScore(): number {
    const recentMetrics = this.metrics.slice(-100); // Last 100 runs
    if (recentMetrics.length === 0) return 0;

    const successfulRuns = recentMetrics.filter(m => m.success);
    const successRate = (successfulRuns.length / recentMetrics.length) * 100;

    // Calculate average execution time (lower is better)
    const avgExecutionTime = successfulRuns.length > 0 
      ? successfulRuns.reduce((sum, m) => sum + m.executionTime, 0) / successfulRuns.length 
      : 0;

    // Calculate average objective value (higher is better)
    const avgObjectiveValue = successfulRuns.length > 0 
      ? successfulRuns.reduce((sum, m) => sum + m.objectiveValue, 0) / successfulRuns.length 
      : 0;

    // Efficiency score: 0-100
    // 40% success rate + 30% execution time efficiency + 30% objective value
    const executionTimeScore = Math.max(0, 100 - (avgExecutionTime / 1000) * 30); // Normalize to 30 points
    const objectiveValueScore = Math.min(30, (avgObjectiveValue / 100) * 30); // Normalize to 30 points
    const successRateScore = successRate * 0.4; // 40 points

    return Math.round(successRateScore + executionTimeScore + objectiveValueScore);
  }
}

export const performanceMonitoringService = PerformanceMonitoringService.getInstance(); 