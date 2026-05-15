import * as k8s from '@kubernetes/client-node'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

export type PsaLevel = 'privileged' | 'baseline' | 'restricted'

export interface NamespacePsaStatus {
  namespace: string
  enforce?: PsaLevel
  audit?: PsaLevel
  warn?: PsaLevel
  isSystem: boolean
}

const SYSTEM_NAMESPACES = new Set(['kube-system', 'kube-public', 'kube-node-lease'])

export class PsaReconEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(_options: ReconOptions): Promise<ReconToolResult> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)

    try {
      const response = await coreApi.listNamespace()

      const namespaces: NamespacePsaStatus[] = response.items.map(ns => {
        const name = ns.metadata?.name ?? ''
        const labels = ns.metadata?.labels ?? {}
        return {
          namespace: name,
          enforce: labels['pod-security.kubernetes.io/enforce'] as PsaLevel | undefined,
          audit: labels['pod-security.kubernetes.io/audit'] as PsaLevel | undefined,
          warn: labels['pod-security.kubernetes.io/warn'] as PsaLevel | undefined,
          isSystem: SYSTEM_NAMESPACES.has(name),
        }
      })

      return {
        tool: 'psa',
        status: 'ok',
        findings: this.analyze(namespaces),
        data: { namespaces },
      }
    } catch (err: unknown) {
      if (this.statusCode(err) === 403) {
        return {
          tool: 'psa',
          status: 'skip',
          findings: [{
            severity: 'SKIP',
            title: 'PSA recon skipped',
            detail: 'Cannot list namespaces — insufficient permissions',
            missingPermission: 'list namespaces',
            coverageImpact: 'Pod Security Admission label coverage cannot be assessed',
          }],
          data: {},
        }
      }
      return { tool: 'psa', status: 'error', findings: [], data: { error: this.message(err) } }
    }
  }

  private analyze(namespaces: NamespacePsaStatus[]): ReconFinding[] {
    const findings: ReconFinding[] = []
    const userNamespaces = namespaces.filter(n => !n.isSystem)

    const noLabels = userNamespaces.filter(n => !n.enforce && !n.audit && !n.warn)
    const auditOnly = userNamespaces.filter(n => !n.enforce && (n.audit || n.warn))

    if (noLabels.length > 0) {
      findings.push({
        severity: 'WARN',
        title: `${noLabels.length} user namespace(s) have no PSA labels`,
        detail: `Pod security is entirely unenforced in: ${noLabels.map(n => n.namespace).join(', ')}`,
      })
    }

    if (auditOnly.length > 0) {
      findings.push({
        severity: 'WARN',
        title: `${auditOnly.length} namespace(s) have PSA in audit/warn mode only`,
        detail: `No enforce label — violations are logged but non-compliant pods are admitted: ${auditOnly.map(n => n.namespace).join(', ')}`,
      })
    }

    if (noLabels.length === 0 && auditOnly.length === 0 && userNamespaces.length > 0) {
      findings.push({
        severity: 'INFO',
        title: 'All user namespaces have PSA enforce labels',
        detail: 'Pod Security Admission enforcement is active across all non-system namespaces',
      })
    }

    return findings
  }

  private statusCode(err: unknown): number | undefined {
    const e = err as Record<string, unknown>
    if (typeof e?.['code'] === 'number') return e['code']
    return (e?.['response'] as Record<string, unknown> | undefined)?.['statusCode'] as number | undefined
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}
