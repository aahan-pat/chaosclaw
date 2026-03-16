export type ScenarioCategory = 'preventive' | 'detective' | 'responsive'

export type SafetyLevel = 'low' | 'medium' | 'high'

export type ExpectedOutcomeType = 'admission_rejected' | 'admission_allowed'

export interface ScenarioPrerequisite {
  name: string
  description: string
}

export interface ScenarioExpectedOutcome {
  type: ExpectedOutcomeType
}

export interface ScenarioCleanup {
  deleteCreatedResources: boolean
}

export interface ScenarioSafety {
  level: SafetyLevel
  namespaceScoped: boolean
}

export interface ScenarioDefinition {
  id: string
  version: number
  name: string
  description: string
  category: ScenarioCategory
  controlObjective: string
  prerequisites: ScenarioPrerequisite[]
  /** Kubernetes manifest as a plain object, applied to the test namespace */
  manifest: Record<string, unknown>
  expectedOutcome: ScenarioExpectedOutcome
  cleanup: ScenarioCleanup
  safety: ScenarioSafety
  packMembership?: string[]
}

export interface ScenarioPack {
  id: string
  version: number
  name: string
  description: string
  scenarioIds: string[]
}
