// Types for the reconnaissance layer — read-only cluster survey run before pentest execution.
// These are intentionally separate from the scenario evidence schema (types/evidence.ts):
// recon findings feed OpenClaw for analysis and manifest generation, not the pass/fail verdict system.

export type ReconFindingSeverity = 'CRITICAL' | 'HIGH' | 'WARN' | 'INFO' | 'SKIP'

export interface ReconFinding {
  severity: ReconFindingSeverity
  title: string
  detail: string
  /** Present on SKIP findings — which permission was missing */
  missingPermission?: string
  /** Present on SKIP findings — what coverage was lost as a result */
  coverageImpact?: string
}

/** Result from one recon tool — always returned, never thrown, even on permission errors */
export interface ReconToolResult {
  tool: string
  status: 'ok' | 'skip' | 'error'
  findings: ReconFinding[]
  /** Raw structured data from the API for OpenClaw consumption */
  data: unknown
}

/** Top-level artifact written by `chaosclaw recon all` */
export interface ReconReport {
  runId: string
  clusterContext: string
  namespace: string
  startedAt: string
  endedAt: string
  summary: {
    critical: number
    high: number
    warn: number
    info: number
    skip: number
  }
  tools: ReconToolResult[]
}

export interface ReconOptions {
  namespace: string
  context?: string
  verbose?: boolean
  /** rbac only — include kube-system service accounts (off by default) */
  includeSystem?: boolean
  /** policies only — force a specific engine: 'kyverno' | 'gatekeeper' | 'auto' */
  engine?: string
}
