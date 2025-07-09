import { linearProgrammingService } from "@/services/LinearProgrammingService";
import { performanceMonitoringService } from "@/services/PerformanceMonitoringService";
import { Property } from "@/models/Property";
import { Tenant } from "@/models/Tenant";
import type { OptimizationConstraints, OptimizationWeights } from "@/types";
import { logger } from "@/utils/logger";

interface TestScenario {
  name: string;
  constraints: OptimizationConstraints;
  weights?: Partial<OptimizationWeights>;
  expectedMinMatches: number;
  expectedMaxExecutionTime: number;
}

interface TestResult {
  scenario: string;
  success: boolean;
  executionTime: number;
  matchesFound: number;
  objectiveValue: number;
  error?: string;
  performance: {
    memoryUsage: number;
    constraintsSatisfied: string[];
  };
}

class OptimizationTester {
  private testScenarios: TestScenario[] = [
    {
      name: "Basic Budget Constraint",
      constraints: {
        budget: { min: 50000, max: 150000 },
        location: "Lagos",
        amenities: ["parking", "security"],
        bedrooms: 2,
        bathrooms: 1,
      },
      expectedMinMatches: 1,
      expectedMaxExecutionTime: 5000,
    },
    {
      name: "High-End Property Search",
      constraints: {
        budget: { min: 200000, max: 500000 },
        location: "Victoria Island",
        amenities: ["gym", "pool", "security", "parking"],
        bedrooms: 3,
        bathrooms: 2,
        features: {
          furnished: true,
          petFriendly: true,
          parking: true,
          balcony: true,
        },
        utilities: {
          electricity: true,
          water: true,
          internet: true,
          gas: true,
        },
      },
      expectedMinMatches: 0, // Might be 0 for high-end constraints
      expectedMaxExecutionTime: 5000,
    },
    {
      name: "Student Budget Search",
      constraints: {
        budget: { min: 30000, max: 80000 },
        location: "Yaba",
        amenities: ["internet"],
        bedrooms: 1,
        bathrooms: 1,
        features: {
          furnished: false,
          petFriendly: false,
          parking: false,
          balcony: false,
        },
      },
      expectedMinMatches: 1,
      expectedMaxExecutionTime: 5000,
    },
    {
      name: "Family Home Search",
      constraints: {
        budget: { min: 100000, max: 300000 },
        location: "Lekki",
        amenities: ["parking", "security", "playground"],
        bedrooms: 4,
        bathrooms: 3,
        features: {
          furnished: false,
          petFriendly: true,
          parking: true,
          balcony: true,
        },
      },
      expectedMinMatches: 0,
      expectedMaxExecutionTime: 5000,
    },
    {
      name: "Flexible Location Search",
      constraints: {
        budget: { min: 50000, max: 120000 },
        location: "Lagos", // Broad location
        amenities: ["parking"],
        bedrooms: 2,
        bathrooms: 1,
      },
      expectedMinMatches: 1,
      expectedMaxExecutionTime: 5000,
    },
  ];

  private customWeights: OptimizationWeights[] = [
    {
      budget: 0.4,
      location: 0.3,
      amenities: 0.1,
      size: 0.1,
      features: 0.05,
      utilities: 0.05,
    },
    {
      budget: 0.2,
      location: 0.4,
      amenities: 0.2,
      size: 0.1,
      features: 0.05,
      utilities: 0.05,
    },
    {
      budget: 0.1,
      location: 0.2,
      amenities: 0.3,
      size: 0.2,
      features: 0.1,
      utilities: 0.1,
    },
  ];

  /**
   * Run comprehensive optimization tests
   */
  public async runComprehensiveTests(): Promise<void> {
    logger.info("Starting comprehensive optimization tests");

    const results: TestResult[] = [];
    let totalTests = 0;
    let successfulTests = 0;
    let totalExecutionTime = 0;

    // Test basic scenarios
    for (const scenario of this.testScenarios) {
      const result = await this.runTestScenario(scenario);
      results.push(result);
      totalTests++;
      if (result.success) {
        successfulTests++;
        totalExecutionTime += result.executionTime;
      }
    }

    // Test with different weight configurations
    for (const weights of this.customWeights) {
      const scenario = this.testScenarios[0]; // Use basic scenario
      const result = await this.runTestScenario({
        ...scenario,
        name: `${scenario.name} - Custom Weights`,
        weights,
      });
      results.push(result);
      totalTests++;
      if (result.success) {
        successfulTests++;
        totalExecutionTime += result.executionTime;
      }
    }

    // Test edge cases
    const edgeCaseResults = await this.runEdgeCaseTests();
    results.push(...edgeCaseResults);
    totalTests += edgeCaseResults.length;
    successfulTests += edgeCaseResults.filter(r => r.success).length;

    // Generate test report
    this.generateTestReport(results, totalTests, successfulTests, totalExecutionTime);
  }

  /**
   * Run a single test scenario
   */
  private async runTestScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage().heapUsed;

    try {
      logger.info(`Running test scenario: ${scenario.name}`);

      const result = await linearProgrammingService.optimizeMatching(
        scenario.constraints,
        scenario.weights,
        10
      );

      const executionTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryUsage = finalMemory - initialMemory;

      const success = this.validateTestResult(result, scenario);

      // Record performance metrics
      performanceMonitoringService.recordMetrics({
        executionTime,
        memoryUsage: memoryUsage / 1024 / 1024, // Convert to MB
        cpuUsage: 0,
        algorithm: "test_optimization",
        constraintsCount: Object.keys(scenario.constraints).length,
        propertiesEvaluated: result.optimizationDetails.totalPropertiesEvaluated,
        matchesFound: result.matches.length,
        objectiveValue: result.optimizationDetails.objectiveValue,
        success,
      });

      return {
        scenario: scenario.name,
        success,
        executionTime,
        matchesFound: result.matches.length,
        objectiveValue: result.optimizationDetails.objectiveValue,
        performance: {
          memoryUsage: memoryUsage / 1024 / 1024,
          constraintsSatisfied: result.optimizationDetails.constraintsSatisfied,
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryUsage = finalMemory - initialMemory;

      // Record failure metrics
      performanceMonitoringService.recordMetrics({
        executionTime,
        memoryUsage: memoryUsage / 1024 / 1024,
        cpuUsage: 0,
        algorithm: "test_optimization",
        constraintsCount: Object.keys(scenario.constraints).length,
        propertiesEvaluated: 0,
        matchesFound: 0,
        objectiveValue: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        scenario: scenario.name,
        success: false,
        executionTime,
        matchesFound: 0,
        objectiveValue: 0,
        error: error instanceof Error ? error.message : "Unknown error",
        performance: {
          memoryUsage: memoryUsage / 1024 / 1024,
          constraintsSatisfied: [],
        },
      };
    }
  }

  /**
   * Validate test result against expectations
   */
  private validateTestResult(result: any, scenario: TestScenario): boolean {
    // Check execution time
    if (result.optimizationDetails.executionTime > scenario.expectedMaxExecutionTime) {
      logger.warn(`Test ${scenario.name} exceeded expected execution time`);
      return false;
    }

    // Check minimum matches (if expected)
    if (scenario.expectedMinMatches > 0 && result.matches.length < scenario.expectedMinMatches) {
      logger.warn(`Test ${scenario.name} found fewer matches than expected`);
      return false;
    }

    // Check objective value
    if (result.optimizationDetails.objectiveValue < 0) {
      logger.warn(`Test ${scenario.name} has negative objective value`);
      return false;
    }

    // Check constraints satisfaction
    if (result.optimizationDetails.constraintsSatisfied.length === 0 && result.matches.length > 0) {
      logger.warn(`Test ${scenario.name} has matches but no satisfied constraints`);
      return false;
    }

    return true;
  }

  /**
   * Run edge case tests
   */
  private async runEdgeCaseTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Test with empty constraints
    try {
      const result = await linearProgrammingService.optimizeMatching(
        {
          budget: { min: 0, max: 0 },
          location: "",
          amenities: [],
          bedrooms: 0,
          bathrooms: 0,
        },
        {},
        10
      );
      results.push({
        scenario: "Empty Constraints",
        success: result.matches.length === 0,
        executionTime: result.optimizationDetails.executionTime,
        matchesFound: result.matches.length,
        objectiveValue: result.optimizationDetails.objectiveValue,
        performance: {
          memoryUsage: 0,
          constraintsSatisfied: result.optimizationDetails.constraintsSatisfied,
        },
      });
    } catch (error) {
      results.push({
        scenario: "Empty Constraints",
        success: false,
        executionTime: 0,
        matchesFound: 0,
        objectiveValue: 0,
        error: error instanceof Error ? error.message : "Unknown error",
        performance: {
          memoryUsage: 0,
          constraintsSatisfied: [],
        },
      });
    }

    // Test with very high budget
    try {
      const result = await linearProgrammingService.optimizeMatching(
        {
          budget: { min: 1000000, max: 5000000 },
          location: "Lagos",
          amenities: ["luxury"],
          bedrooms: 5,
          bathrooms: 4,
        },
        {},
        10
      );
      results.push({
        scenario: "Very High Budget",
        success: true,
        executionTime: result.optimizationDetails.executionTime,
        matchesFound: result.matches.length,
        objectiveValue: result.optimizationDetails.objectiveValue,
        performance: {
          memoryUsage: 0,
          constraintsSatisfied: result.optimizationDetails.constraintsSatisfied,
        },
      });
    } catch (error) {
      results.push({
        scenario: "Very High Budget",
        success: false,
        executionTime: 0,
        matchesFound: 0,
        objectiveValue: 0,
        error: error instanceof Error ? error.message : "Unknown error",
        performance: {
          memoryUsage: 0,
          constraintsSatisfied: [],
        },
      });
    }

    return results;
  }

  /**
   * Generate comprehensive test report
   */
  private generateTestReport(
    results: TestResult[],
    totalTests: number,
    successfulTests: number,
    totalExecutionTime: number
  ): void {
    const successRate = (successfulTests / totalTests) * 100;
    const averageExecutionTime = successfulTests > 0 ? totalExecutionTime / successfulTests : 0;

    logger.info("=== OPTIMIZATION TEST REPORT ===");
    logger.info(`Total Tests: ${totalTests}`);
    logger.info(`Successful Tests: ${successfulTests}`);
    logger.info(`Success Rate: ${successRate.toFixed(2)}%`);
    logger.info(`Average Execution Time: ${averageExecutionTime.toFixed(2)}ms`);
    logger.info(`Total Execution Time: ${totalExecutionTime}ms`);

    // Performance statistics
    const performanceStats = performanceMonitoringService.getOverallPerformance();
    const efficiencyScore = performanceMonitoringService.getEfficiencyScore();

    logger.info("=== PERFORMANCE STATISTICS ===");
    logger.info(`Overall Efficiency Score: ${efficiencyScore}/100`);
    logger.info(`Total Optimizations: ${performanceStats.totalOptimizations}`);
    logger.info(`Average Execution Time: ${performanceStats.averageExecutionTime.toFixed(2)}ms`);
    logger.info(`Success Rate: ${performanceStats.successRate.toFixed(2)}%`);

    // Detailed results
    logger.info("=== DETAILED TEST RESULTS ===");
    results.forEach((result, index) => {
      logger.info(`${index + 1}. ${result.scenario}`);
      logger.info(`   Success: ${result.success}`);
      logger.info(`   Execution Time: ${result.executionTime}ms`);
      logger.info(`   Matches Found: ${result.matchesFound}`);
      logger.info(`   Objective Value: ${result.objectiveValue.toFixed(2)}`);
      if (result.error) {
        logger.info(`   Error: ${result.error}`);
      }
      logger.info("");
    });

    // Recommendations
    logger.info("=== RECOMMENDATIONS ===");
    if (successRate < 80) {
      logger.warn("Success rate is below 80%. Consider reviewing constraint validation.");
    }
    if (averageExecutionTime > 3000) {
      logger.warn("Average execution time is high. Consider optimizing the algorithm.");
    }
    if (efficiencyScore < 70) {
      logger.warn("Efficiency score is low. Consider improving algorithm performance.");
    }

    logger.info("=== TEST COMPLETED ===");
  }

  /**
   * Run performance benchmark tests
   */
  public async runPerformanceBenchmarks(): Promise<void> {
    logger.info("Starting performance benchmark tests");

    const benchmarkScenarios = [
      { name: "Small Dataset", maxResults: 5 },
      { name: "Medium Dataset", maxResults: 10 },
      { name: "Large Dataset", maxResults: 20 },
    ];

    const constraints: OptimizationConstraints = {
      budget: { min: 50000, max: 150000 },
      location: "Lagos",
      amenities: ["parking"],
      bedrooms: 2,
      bathrooms: 1,
    };

    for (const scenario of benchmarkScenarios) {
      const times: number[] = [];
      const iterations = 10;

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        try {
          await linearProgrammingService.optimizeMatching(
            constraints,
            {},
            scenario.maxResults
          );
          const executionTime = Date.now() - startTime;
          times.push(executionTime);
        } catch (error) {
          logger.error(`Benchmark iteration ${i + 1} failed:`, error);
        }
      }

      if (times.length > 0) {
        const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);

        logger.info(`Benchmark - ${scenario.name}:`);
        logger.info(`  Average Time: ${avgTime.toFixed(2)}ms`);
        logger.info(`  Min Time: ${minTime}ms`);
        logger.info(`  Max Time: ${maxTime}ms`);
        logger.info(`  Iterations: ${times.length}/${iterations}`);
      }
    }
  }
}

// Export for use in other scripts
export { OptimizationTester };

// Run tests if this script is executed directly
if (require.main === module) {
  const tester = new OptimizationTester();
  
  async function runTests() {
    try {
      await tester.runComprehensiveTests();
      await tester.runPerformanceBenchmarks();
      process.exit(0);
    } catch (error) {
      logger.error("Test execution failed:", error);
      process.exit(1);
    }
  }

  runTests();
} 