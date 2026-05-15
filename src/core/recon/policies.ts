import * as k8s from '@kubernetes/client-node'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

export type PolicyEngine = 'kyverno' | 'gatekeeper' | 'none'

export interface PolicyInfo {
  name: string
  engine: PolicyEngine
  /** 'Enforce' | 'Audit' for Kyverno; Gatekeeper uses a different mechanism */
  validationFailureAction?: string
}

interface EngineProbeResult {
  installed: boolean
  permissionDenied: boolean
  policies: PolicyInfo[]
}

export class PolicyReconEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(options: ReconOptions): Promise<ReconToolResult> {
    const engineOverride = options.engine ?? 'auto'
    const findings: ReconFinding[] = []
    const policies: PolicyInfo[] = []
    let detectedEngine: PolicyEngine = 'none'

    if (engineOverride === 'auto' || engineOverride === 'kyverno') {
      const result = await this.probeKyverno()
      if (result.installed) {
        detectedEngine = 'kyverno'
        policies.push(...result.policies)
        if (result.permissionDenied) {
          findings.push({
            severity: 'SKIP',
            title: 'Kyverno policy read skipped',
            detail: 'Kyverno is installed but clusterpolicies cannot be listed — insufficient permissions',
            missingPermission: 'list clusterpolicies.kyverno.io',
            coverageImpact: 'Kyverno policy enforcement modes cannot be assessed',
          })
        }
      }
    }

    if (detectedEngine === 'none' && (engineOverride === 'auto' || engineOverride === 'gatekeeper')) {
      const result = await this.probeGatekeeper()
      if (result.installed) {
        detectedEngine = 'gatekeeper'
        policies.push(...result.policies)
        if (result.permissionDenied) {
          findings.push({
            severity: 'SKIP',
            title: 'Gatekeeper constraint read skipped',
            detail: 'Gatekeeper is installed but constrainttemplates cannot be listed — insufficient permissions',
            missingPermission: 'list constrainttemplates.constraints.gatekeeper.sh',
            coverageImpact: 'Gatekeeper constraint coverage cannot be assessed',
          })
        }
      }
    }

    if (detectedEngine === 'none') {
      findings.push({
        severity: 'CRITICAL',
        title: 'No policy engine detected',
        detail: 'Kyverno and OPA/Gatekeeper are not installed. The cluster has no admission-level policy enforcement beyond built-in PSA. All preventive-baseline scenarios will likely be SKIPPED.',
      })
    } else if (policies.length > 0) {
      const auditOnly = policies.filter(p => p.validationFailureAction?.toLowerCase() === 'audit')
      for (const p of auditOnly) {
        findings.push({
          severity: 'WARN',
          title: `${p.name} is in Audit mode`,
          detail: 'Violations are logged but non-compliant workloads are admitted — this policy does not block anything',
        })
      }
      if (auditOnly.length === 0) {
        findings.push({
          severity: 'INFO',
          title: `${policies.length} ${detectedEngine} policy/policies detected — all in Enforce mode`,
          detail: 'All policies are actively blocking non-compliant resources',
        })
      }
    }

    const isSkipped = findings.some(f => f.severity === 'SKIP') && policies.length === 0

    return {
      tool: 'policies',
      status: isSkipped ? 'skip' : 'ok',
      findings,
      data: { engine: detectedEngine, policies },
    }
  }

  private async probeKyverno(): Promise<EngineProbeResult> {
    const customApi = this.kc.makeApiClient(k8s.CustomObjectsApi)
    try {
      const response = await customApi.listClusterCustomObject({
        group: 'kyverno.io',
        version: 'v1',
        plural: 'clusterpolicies',
      }) as { items?: unknown[] }

      const policies: PolicyInfo[] = (response.items ?? []).map((item: unknown) => {
        const obj = item as Record<string, unknown>
        const spec = obj['spec'] as Record<string, unknown> | undefined
        const meta = obj['metadata'] as Record<string, unknown> | undefined
        return {
          name: meta?.['name'] as string ?? 'unknown',
          engine: 'kyverno',
          validationFailureAction: spec?.['validationFailureAction'] as string | undefined,
        }
      })

      return { installed: true, permissionDenied: false, policies }
    } catch (err: unknown) {
      const code = this.statusCode(err)
      if (code === 404) return { installed: false, permissionDenied: false, policies: [] }
      if (code === 403) return { installed: true, permissionDenied: true, policies: [] }
      return { installed: false, permissionDenied: false, policies: [] }
    }
  }

  private async probeGatekeeper(): Promise<EngineProbeResult> {
    const customApi = this.kc.makeApiClient(k8s.CustomObjectsApi)
    try {
      const response = await customApi.listClusterCustomObject({
        group: 'constraints.gatekeeper.sh',
        version: 'v1beta1',
        plural: 'constrainttemplates',
      }) as { items?: unknown[] }

      const policies: PolicyInfo[] = (response.items ?? []).map((item: unknown) => {
        const obj = item as Record<string, unknown>
        const meta = obj['metadata'] as Record<string, unknown> | undefined
        return {
          name: meta?.['name'] as string ?? 'unknown',
          engine: 'gatekeeper',
        }
      })

      return { installed: true, permissionDenied: false, policies }
    } catch (err: unknown) {
      const code = this.statusCode(err)
      if (code === 404) return { installed: false, permissionDenied: false, policies: [] }
      if (code === 403) return { installed: true, permissionDenied: true, policies: [] }
      return { installed: false, permissionDenied: false, policies: [] }
    }
  }

  private statusCode(err: unknown): number | undefined {
    const e = err as Record<string, unknown>
    if (typeof e?.['code'] === 'number') return e['code']
    return (e?.['response'] as Record<string, unknown> | undefined)?.['statusCode'] as number | undefined
  }
}
