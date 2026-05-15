import * as k8s from '@kubernetes/client-node'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

export interface NodeInfo {
  name: string
  os: string
  kernel: string
  runtime: string
  appArmorEnabled: boolean
  seccompDefault: string
}

export class NodeReconEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(_options: ReconOptions): Promise<ReconToolResult> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)

    try {
      const response = await coreApi.listNode()
      const nodes = response.items.map(this.extractNodeInfo)
      const findings = this.analyze(nodes)

      return { tool: 'nodes', status: 'ok', findings, data: { nodes } }
    } catch (err: unknown) {
      if (this.statusCode(err) === 403) {
        return {
          tool: 'nodes',
          status: 'skip',
          findings: [{
            severity: 'SKIP',
            title: 'Node recon skipped',
            detail: 'Cannot list nodes — insufficient permissions',
            missingPermission: 'list nodes',
            coverageImpact: 'Node kernel versions, container runtimes, and security feature support cannot be assessed',
          }],
          data: {},
        }
      }
      return { tool: 'nodes', status: 'error', findings: [], data: { error: this.message(err) } }
    }
  }

  private extractNodeInfo = (node: k8s.V1Node): NodeInfo => {
    const info = node.status?.nodeInfo
    return {
      name: node.metadata?.name ?? 'unknown',
      os: info?.osImage ?? 'unknown',
      kernel: info?.kernelVersion ?? 'unknown',
      runtime: info?.containerRuntimeVersion ?? 'unknown',
      // AppArmor presence is surfaced via node annotations in some distributions
      appArmorEnabled: Object.keys(node.metadata?.annotations ?? {}).some(k => k.toLowerCase().includes('apparmor')),
      seccompDefault: 'runtime/default',
    }
  }

  private analyze(nodes: NodeInfo[]): ReconFinding[] {
    if (nodes.length === 0) return []

    const findings: ReconFinding[] = []

    // Flag nodes running a different kernel than the majority
    const kernelCounts = new Map<string, number>()
    for (const n of nodes) kernelCounts.set(n.kernel, (kernelCounts.get(n.kernel) ?? 0) + 1)
    const sorted = [...kernelCounts.entries()].sort((a, b) => b[1] - a[1])
    const top = sorted[0]
    if (!top) return []
    const dominantKernel = top[0]
    const outliers = nodes.filter(n => n.kernel !== dominantKernel)

    if (outliers.length > 0) {
      findings.push({
        severity: 'INFO',
        title: `${outliers.length} node(s) running a different kernel version`,
        detail: outliers.map(n => `${n.name}: kernel ${n.kernel}, runtime ${n.runtime}`).join('; '),
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
