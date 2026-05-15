import * as k8s from '@kubernetes/client-node'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

export interface NamespaceNetworkStatus {
  namespace: string
  policyCount: number
  hasIngress: boolean
  hasEgress: boolean
}

const SYSTEM_NAMESPACES = new Set(['kube-system', 'kube-public', 'kube-node-lease'])

export class NetworkPolicyReconEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(_options: ReconOptions): Promise<ReconToolResult> {
    const networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api)
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)

    try {
      const [policiesRes, namespacesRes] = await Promise.all([
        networkingApi.listNetworkPolicyForAllNamespaces(),
        coreApi.listNamespace(),
      ])

      const userNamespaces = namespacesRes.items
        .map(n => n.metadata?.name ?? '')
        .filter(n => n && !SYSTEM_NAMESPACES.has(n))

      // Group policies by namespace
      const byNamespace = new Map<string, k8s.V1NetworkPolicy[]>()
      for (const ns of userNamespaces) byNamespace.set(ns, [])
      for (const policy of policiesRes.items) {
        const ns = policy.metadata?.namespace ?? ''
        if (!SYSTEM_NAMESPACES.has(ns)) {
          byNamespace.set(ns, [...(byNamespace.get(ns) ?? []), policy])
        }
      }

      const namespaces: NamespaceNetworkStatus[] = [...byNamespace.entries()].map(([ns, policies]) => ({
        namespace: ns,
        policyCount: policies.length,
        hasIngress: policies.some(p => {
          const types = p.spec?.policyTypes ?? []
          return types.includes('Ingress') || types.length === 0
        }),
        hasEgress: policies.some(p => (p.spec?.policyTypes ?? []).includes('Egress')),
      }))

      return {
        tool: 'network-policies',
        status: 'ok',
        findings: this.analyze(namespaces),
        data: { namespaces },
      }
    } catch (err: unknown) {
      if (this.statusCode(err) === 403) {
        return {
          tool: 'network-policies',
          status: 'skip',
          findings: [{
            severity: 'SKIP',
            title: 'Network policy recon skipped',
            detail: 'Cannot list NetworkPolicies cluster-wide — insufficient permissions',
            missingPermission: 'list networkpolicies (all namespaces)',
            coverageImpact: 'Network segmentation gaps cannot be identified',
          }],
          data: {},
        }
      }
      return { tool: 'network-policies', status: 'error', findings: [], data: { error: this.message(err) } }
    }
  }

  private analyze(namespaces: NamespaceNetworkStatus[]): ReconFinding[] {
    const findings: ReconFinding[] = []

    const unprotected = namespaces.filter(n => n.policyCount === 0)
    const ingressOnly = namespaces.filter(n => n.policyCount > 0 && !n.hasEgress)

    if (unprotected.length > 0) {
      const names = unprotected.map(n => n.namespace).join(', ')
      findings.push({
        severity: unprotected.some(n => n.namespace === 'default') ? 'HIGH' : 'WARN',
        title: `${unprotected.length} namespace(s) have no NetworkPolicies`,
        detail: `All pod-to-pod traffic is unrestricted in: ${names}`,
      })
    }

    if (ingressOnly.length > 0) {
      findings.push({
        severity: 'WARN',
        title: `${ingressOnly.length} namespace(s) have no egress NetworkPolicies`,
        detail: `Outbound traffic is unrestricted in: ${ingressOnly.map(n => n.namespace).join(', ')}`,
      })
    }

    if (unprotected.length === 0 && ingressOnly.length === 0 && namespaces.length > 0) {
      findings.push({
        severity: 'INFO',
        title: 'All user namespaces have NetworkPolicies with ingress and egress rules',
        detail: 'Network segmentation is in place across all non-system namespaces',
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
