export type ScenarioOutcome = 'Pass' | 'Fail' | 'Error' | 'Skipped'

export type CleanupStatus = 'success' | 'failed' | 'skipped' | 'partial'

export interface ScenarioResult {
  scenarioId: string
  version: number
  status: ScenarioOutcome
  expectedOutcome: string
  observedOutcome: string
  cleanupStatus: CleanupStatus
  startedAt: string
  endedAt: string
  rawResponse?: string
  manifestSnapshot?: string
  likelyIssue?: string
  skipReason?: string
  errorReason?: string
}

export interface RunSummary {
  pass: number
  fail: number
  error: number
  skipped: number
}

export interface RunEvidence {
  runId: string
  toolVersion: string
  clusterContext: string
  initiatedBy: string
  packId?: string
  packVersion?: string
  scenarioId?: string
  startedAt: string
  endedAt: string
  summary: RunSummary
  results: ScenarioResult[]
}
