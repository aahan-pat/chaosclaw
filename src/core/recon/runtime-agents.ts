import * as k8s from '@kubernetes/client-node'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

export interface AgentStatus {
  name: string
  detected: boolean
  readyNodes?: number
  desiredNodes?: number
  namespace?: string
}

// Well-known DaemonSet names for each runtime security agent
const KNOWN_AGENTS: Record<string, string[]> = {
  Falco: ['falco', 'falco-falco', 'falco-node'],
  KubeArmor: ['kubearmor'],
  Tetragon: ['tetragon'],
  Tracee: ['tracee'],
}

export class RuntimeAgentReconEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(_options: ReconOptions): Promise<ReconToolResult> {
    const appsApi = this.kc.makeApiClient(k8s.AppsV1Api)

    try {
      const response = await appsApi.listDaemonSetForAllNamespaces()
      const daemonsets = response.items

      const agents: AgentStatus[] = Object.entries(KNOWN_AGENTS).map(([agentName, knownNames]) => {
        const ds = daemonsets.find(d => knownNames.includes(d.metadata?.name ?? ''))
        if (!ds) return { name: agentName, detected: false }
        return {
          name: agentName,
          detected: true,
          readyNodes: ds.status?.numberReady ?? 0,
          desiredNodes: ds.status?.desiredNumberScheduled ?? 0,
          namespace: ds.metadata?.namespace ?? 'unknown',
        }
      })

      return {
        tool: 'runtime-agents',
        status: 'ok',
        findings: this.analyze(agents),
        data: { daemonsetsScanned: daemonsets.length, agents },
      }
    } catch (err: unknown) {
      if (this.statusCode(err) === 403) {
        return {
          tool: 'runtime-agents',
          status: 'skip',
          findings: [{
            severity: 'SKIP',
            title: 'Runtime agent recon skipped',
            detail: 'Cannot list DaemonSets cluster-wide — insufficient permissions',
            missingPermission: 'list daemonsets (all namespaces)',
            coverageImpact: 'Runtime detection agent presence cannot be confirmed',
          }],
          data: {},
        }
      }
      return { tool: 'runtime-agents', status: 'error', findings: [], data: { error: this.message(err) } }
    }
  }

  private analyze(agents: AgentStatus[]): ReconFinding[] {
    const findings: ReconFinding[] = []
    const detected = agents.filter(a => a.detected)

    if (detected.length === 0) {
      findings.push({
        severity: 'HIGH',
        title: 'No runtime detection agents detected',
        detail: 'Falco, KubeArmor, Tetragon, and Tracee are all absent. Runtime behavioral detection is unavailable.',
      })
      return findings
    }

    for (const agent of detected) {
      const coverage = agent.readyNodes === agent.desiredNodes
        ? 'full node coverage'
        : `${agent.readyNodes}/${agent.desiredNodes} nodes ready`
      findings.push({
        severity: 'INFO',
        title: `${agent.name} detected (${coverage})`,
        detail: `Deployed in namespace: ${agent.namespace}`,
      })
    }

    const hasFalco = agents.find(a => a.name === 'Falco')?.detected
    const hasLsm = agents.find(a => a.name === 'KubeArmor')?.detected
      || agents.find(a => a.name === 'Tetragon')?.detected

    if (hasFalco && !hasLsm) {
      findings.push({
        severity: 'WARN',
        title: 'No LSM-based runtime enforcement detected',
        detail: 'KubeArmor and Tetragon are absent. Falco detects threats but cannot block syscalls at the kernel level.',
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
