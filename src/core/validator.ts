import type { ScenarioDefinition } from '../types/scenario.js'
import type { ScenarioOutcome } from '../types/evidence.js'
import type { ExecutionResult, ObservedOutcome } from './executor.js'

export interface ValidationResult {
  status: ScenarioOutcome
  observedOutcome: string
  likelyIssue?: string
}

export class ValidationEngine {
  validate(scenario: ScenarioDefinition, execution: ExecutionResult): ValidationResult {
    const expected = scenario.expectedOutcome.type

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

    if (expected === execution.observedOutcome) {
      return { status: 'Pass', observedOutcome: observedLabel }
    }

    return {
      status: 'Fail',
      observedOutcome: observedLabel,
      likelyIssue: this.diagnose(scenario, execution.observedOutcome),
    }
  }

  private outcomeLabel(outcome: ObservedOutcome): string {
    switch (outcome) {
      case 'admission_rejected': return 'admission rejected'
      case 'admission_allowed': return 'workload admitted'
      case 'timeout': return 'timeout'
      case 'api_error': return 'API error'
    }
  }

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
