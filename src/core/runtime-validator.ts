import type { RuntimeScenarioDefinition } from '../types/runtime-scenario.js'
import type { RuntimeExecutionResult, RuntimeObservedOutcome } from './runtime-executor.js'
import type { ValidationResult } from './validator.js'

export class RuntimeValidationEngine {
  validate(scenario: RuntimeScenarioDefinition, execution: RuntimeExecutionResult): ValidationResult {
    const expected = scenario.expectedOutcome.type

    if (execution.observedOutcome === 'timeout') {
      return {
        status: 'Error',
        observedOutcome: 'timeout',
        likelyIssue: 'Executor timed out before the observation window closed',
      }
    }

    if (execution.observedOutcome === 'api_error') {
      return {
        status: 'Error',
        observedOutcome: 'api_error',
        likelyIssue: 'Kubernetes API error during scenario setup — check cluster connectivity and RBAC',
      }
    }

    const observedLabel = this.outcomeLabel(execution.observedOutcome)

    if (expected === execution.observedOutcome) {
      return { status: 'Pass', observedOutcome: observedLabel }
    }

    return {
      status: 'Fail',
      observedOutcome: observedLabel,
      likelyIssue: this.diagnose(scenario, execution.observedOutcome),
    }
  }

  private outcomeLabel(outcome: RuntimeObservedOutcome): string {
    switch (outcome) {
      case 'alert_fired': return 'alert fired'
      case 'action_blocked': return 'action blocked'
      case 'no_alert': return 'no alert observed'
      case 'timeout': return 'timeout'
      case 'api_error': return 'API error'
    }
  }

  private diagnose(scenario: RuntimeScenarioDefinition, observed: RuntimeObservedOutcome): string {
    if (observed === 'no_alert') {
      return `${scenario.controlObjective} — runtime tool may not be installed, or this rule is not enabled`
    }
    return 'Unexpected outcome — inspect the alert detail for more information'
  }
}
