// Validates runtime detection scenario results by comparing expected and observed outcomes,
// mirroring the structure of ValidationEngine but specialised for alert-based signals.
import type { RuntimeScenarioDefinition } from '../types/runtime-scenario.js'
import type { RuntimeExecutionResult, RuntimeObservedOutcome } from './runtime-executor.js'
import type { ValidationResult } from './validator.js'

// Handles runtime detection scenarios where the expected signal is an alert from the
// runtime security tool rather than an admission decision from the API server.
export class RuntimeValidationEngine {
  validate(scenario: RuntimeScenarioDefinition, execution: RuntimeExecutionResult): ValidationResult {
    // Extract the expected outcome type to use in comparisons below.
    const expected = scenario.expectedOutcome.type

    // Infra-level timeout should be surfaced as Error, not confused with a missing alert.
    if (execution.observedOutcome === 'timeout') {
      return {
        status: 'Error',
        observedOutcome: 'timeout',
        likelyIssue: 'Executor timed out before the observation window closed',
      }
    }

    // Kubernetes API errors during pod submission or exec are infrastructure failures,
    // not detection gaps, so report them as Error instead of Fail.
    if (execution.observedOutcome === 'api_error') {
      return {
        status: 'Error',
        observedOutcome: 'api_error',
        likelyIssue: 'Kubernetes API error during scenario setup — check cluster connectivity and RBAC',
      }
    }

    // Convert the raw outcome enum to a human-readable label for the evidence artifact.
    const observedLabel = this.outcomeLabel(execution.observedOutcome)

    // Direct match — the runtime tool behaved exactly as the scenario intended.
    if (expected === execution.observedOutcome) {
      return { status: 'Pass', observedOutcome: observedLabel }
    }

    // Mismatch — produce a targeted diagnostic so the operator knows where to look.
    return {
      status: 'Fail',
      observedOutcome: observedLabel,
      likelyIssue: this.diagnose(scenario, execution.observedOutcome),
    }
  }

  // Maps each internal RuntimeObservedOutcome value to a display-friendly string.
  private outcomeLabel(outcome: RuntimeObservedOutcome): string {
    switch (outcome) {
      case 'alert_fired': return 'alert fired'
      case 'action_blocked': return 'action blocked'
      case 'no_alert': return 'no alert observed'
      case 'timeout': return 'timeout'
      case 'api_error': return 'API error'
    }
  }

  // Returns a targeted diagnostic message based on the observed outcome;
  // currently only 'no_alert' has a specific hint since it is the most common failure mode.
  private diagnose(scenario: RuntimeScenarioDefinition, observed: RuntimeObservedOutcome): string {
    if (observed === 'no_alert') {
      return `${scenario.controlObjective} — runtime tool may not be installed, or this rule is not enabled`
    }
    return 'Unexpected outcome — inspect the alert detail for more information'
  }
}
