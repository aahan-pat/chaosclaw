// Compares a scenario's expected outcome against what the executor actually observed,
// and produces a human-readable verdict plus a diagnostic hint when the check fails.
import type { ScenarioDefinition } from '../types/scenario.js'
import type { ScenarioOutcome } from '../types/evidence.js'
import type { ExecutionResult, ObservedOutcome } from './executor.js'

/** The verdict produced after comparing expected vs observed outcomes */
export interface ValidationResult {
  status: ScenarioOutcome
  /** Human-readable description of what the cluster did */
  observedOutcome: string
  /** Best-effort explanation of why the scenario did not pass */
  likelyIssue?: string
}

/**
 * Compares expected and observed admission outcomes to produce a Pass/Fail/Error verdict.
 * Error-class outcomes (timeout, api_error) are surfaced before the comparison so they
 * don't incorrectly count as policy failures.
 */
export class ValidationEngine {
  /**
   * Validates a scenario execution result against the scenario's declared expected outcome.
   * @param scenario - The scenario definition containing the expected outcome
   * @param execution - The raw result returned by the executor
   */
  validate(scenario: ScenarioDefinition, execution: ExecutionResult): ValidationResult {
    const expected = scenario.expectedOutcome.type

    // Infra-level errors should be reported separately from policy failures
    if (execution.observedOutcome === 'timeout') {
      return {
        status: 'Error',
        observedOutcome: 'timeout',
        likelyIssue: 'Request timed out waiting for Kubernetes API response',
      }
    }

    if (execution.observedOutcome === 'api_error') {
      return {
        status: 'Error',
        observedOutcome: 'api_error',
        likelyIssue: 'Kubernetes API returned an unexpected error',
      }
    }

    const observedLabel = this.outcomeLabel(execution.observedOutcome)

    // Direct match — the cluster behaved as the scenario intended
    if (expected === execution.observedOutcome) {
      return { status: 'Pass', observedOutcome: observedLabel }
    }

    // Mismatch — include a diagnostic hint so operators know where to look
    return {
      status: 'Fail',
      observedOutcome: observedLabel,
      likelyIssue: this.diagnose(scenario, execution.observedOutcome),
    }
  }

  /** Converts an internal ObservedOutcome enum value to a display-friendly string */
  private outcomeLabel(outcome: ObservedOutcome): string {
    switch (outcome) {
      case 'admission_rejected': return 'admission rejected'
      case 'admission_allowed': return 'workload admitted'
      case 'timeout': return 'timeout'
      case 'api_error': return 'API error'
    }
  }

  /**
   * Produces a targeted hint based on the direction of the mismatch.
   * "Expected reject, got allow" → policy may be missing.
   * "Expected allow, got reject" → policy is over-broad.
   */
  private diagnose(scenario: ScenarioDefinition, observed: ObservedOutcome): string {
    if (scenario.expectedOutcome.type === 'admission_rejected' && observed === 'admission_allowed') {
      return `${scenario.controlObjective} — policy may not be installed, or does not cover this resource type`
    }
    if (scenario.expectedOutcome.type === 'admission_allowed' && observed === 'admission_rejected') {
      return `Policy is more restrictive than expected — check admission rules for ${scenario.controlObjective}`
    }
    return 'Unexpected outcome — inspect the raw response for details'
  }
}
