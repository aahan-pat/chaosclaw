import * as k8s from '@kubernetes/client-node'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

export interface HighPrivilegePrincipal {
  kind: string
  name: string
  namespace?: string
  reason: string
  via: string
}

const SYSTEM_NAMESPACES = new Set(['kube-system', 'kube-public', 'kube-node-lease'])

export class RbacReconEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(options: ReconOptions): Promise<ReconToolResult> {
    const rbacApi = this.kc.makeApiClient(k8s.RbacAuthorizationV1Api)
    const includeSystem = options.includeSystem ?? false

    let roles: k8s.V1ClusterRole[] = []
    let bindings: k8s.V1ClusterRoleBinding[] = []
    const skipFindings: ReconFinding[] = []

    // Fetch roles and bindings independently — partial results are still useful
    try {
      roles = (await rbacApi.listClusterRole()).items
    } catch (err: unknown) {
      if (this.statusCode(err) === 403) {
        skipFindings.push({
          severity: 'SKIP',
          title: 'ClusterRole list skipped',
          detail: 'Cannot list clusterroles — insufficient permissions',
          missingPermission: 'list clusterroles',
          coverageImpact: 'Available cluster-level privilege definitions cannot be enumerated',
        })
      }
    }

    try {
      bindings = (await rbacApi.listClusterRoleBinding()).items
    } catch (err: unknown) {
      if (this.statusCode(err) === 403) {
        skipFindings.push({
          severity: 'SKIP',
          title: 'ClusterRoleBinding list skipped',
          detail: 'Cannot list clusterrolebindings — insufficient permissions',
          missingPermission: 'list clusterrolebindings',
          coverageImpact: 'Who holds cluster-level privileges cannot be determined',
        })
      }
    }

    const analysisFindings = this.analyze(roles, bindings, includeSystem)
    const findings: ReconFinding[] = [...analysisFindings, ...skipFindings]
    const isFullySkipped = skipFindings.length > 0 && analysisFindings.length === 0

    return {
      tool: 'rbac',
      status: isFullySkipped ? 'skip' : 'ok',
      findings,
      data: {
        clusterRoleCount: roles.length,
        clusterRoleBindingCount: bindings.length,
        partial: skipFindings.length > 0,
      },
    }
  }

  private analyze(
    roles: k8s.V1ClusterRole[],
    bindings: k8s.V1ClusterRoleBinding[],
    includeSystem: boolean,
  ): ReconFinding[] {
    const findings: ReconFinding[] = []

    // Non-built-in cluster-admin bindings
    const adminBindings = bindings.filter(b => b.roleRef.name === 'cluster-admin' && b.metadata?.name !== 'cluster-admin')
    for (const binding of adminBindings) {
      const subjects = (binding.subjects ?? [])
        .filter(s => includeSystem || !SYSTEM_NAMESPACES.has(s.namespace ?? ''))
        .map(s => `${s.kind}: ${s.name}${s.namespace ? ` (${s.namespace})` : ''}`)
        .join(', ')
      if (subjects) {
        findings.push({
          severity: 'WARN',
          title: `cluster-admin bound to non-system principal(s)`,
          detail: `${subjects} — via ClusterRoleBinding "${binding.metadata?.name}"`,
        })
      }
    }

    // Service accounts with cluster-wide secret read access
    const roleMap = new Map(roles.map(r => [r.metadata?.name ?? '', r]))
    for (const binding of bindings) {
      const role = roleMap.get(binding.roleRef.name)
      if (!role) continue

      const hasClusterWideSecretRead = (role.rules ?? []).some(rule => {
        const resources = rule.resources ?? []
        const verbs = rule.verbs ?? []
        const coversSecrets = resources.includes('secrets') || resources.includes('*')
        const coversRead = verbs.some(v => ['get', 'list', 'watch', '*'].includes(v))
        // Scoped to specific secret names is not a broad-access concern
        const isBroad = !rule.resourceNames?.length
        return coversSecrets && coversRead && isBroad
      })

      if (!hasClusterWideSecretRead) continue

      const serviceAccounts = (binding.subjects ?? [])
        .filter(s => s.kind === 'ServiceAccount')
        .filter(s => includeSystem || !SYSTEM_NAMESPACES.has(s.namespace ?? ''))

      for (const sa of serviceAccounts) {
        findings.push({
          severity: 'HIGH',
          title: `${sa.namespace ?? '?'}/${sa.name} has cluster-wide secret read access`,
          detail: `Via ClusterRoleBinding "${binding.metadata?.name}" → ClusterRole "${role.metadata?.name}". A compromised token exposes all secrets in all namespaces.`,
        })
      }
    }

    return findings
  }

  private statusCode(err: unknown): number | undefined {
    const e = err as Record<string, unknown>
    if (typeof e?.['code'] === 'number') return e['code']
    return (e?.['response'] as Record<string, unknown> | undefined)?.['statusCode'] as number | undefined
  }
}
