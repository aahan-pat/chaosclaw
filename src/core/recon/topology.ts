import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

// Mirrors the shape written by graphnetes' export/graph.py
interface GraphNode {
  id: string
  kind: string
  name: string
  namespace: string | null
  labels: Record<string, string>
  metadata: Record<string, unknown>
}

interface GraphEdge {
  source: string
  target: string
  relation: string
  confidence: string
  weight: number
}

interface GraphJson {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface TopologyStats {
  nodeCount: number
  edgeCount: number
  byKind: Record<string, number>
  ingressPaths: Array<{ ingressId: string; routesTo: string[] }>
  secretMounts: Array<{ podId: string; secretId: string }>
  serviceAccountBindings: Array<{ podId: string; serviceAccountId: string }>
}

const DEFAULT_GRAPH_PATH = 'graphnetes-out/graph.json'

export class TopologyReconEngine {
  /**
   * @param graphPath - path to an existing graphnetes graph.json; if omitted,
   *   `graphnetes build` is invoked and the output is read from the default location.
   */
  constructor(private readonly graphPath?: string) {}

  async run(options: ReconOptions): Promise<ReconToolResult> {
    const resolvedPath = this.graphPath ?? DEFAULT_GRAPH_PATH

    if (this.graphPath) {
      if (!existsSync(this.graphPath)) {
        return {
          tool: 'topology',
          status: 'error',
          findings: [],
          data: { error: `Graph file not found: ${this.graphPath}` },
        }
      }
    } else {
      if (!this.isGraphnetesAvailable()) {
        return {
          tool: 'topology',
          status: 'skip',
          findings: [{
            severity: 'SKIP',
            title: 'Topology recon skipped — graphnetes not found on PATH',
            detail: 'Install graphnetes and ensure it is on PATH, then re-run. See: https://github.com/aahan-pat/graphnetes',
            missingPermission: 'graphnetes on PATH',
            coverageImpact: 'Cluster resource topology, ingress exposure paths, and secret mount analysis cannot be assessed',
          }],
          data: {},
        }
      }

      const buildErr = this.buildGraph(options)
      if (buildErr !== null) {
        return { tool: 'topology', status: 'error', findings: [], data: { error: buildErr } }
      }
    }

    let graph: GraphJson
    try {
      graph = JSON.parse(readFileSync(resolvedPath, 'utf-8')) as GraphJson
    } catch (err) {
      return {
        tool: 'topology',
        status: 'error',
        findings: [],
        data: { error: `Failed to read ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}` },
      }
    }

    const stats = this.analyze(graph)
    return {
      tool: 'topology',
      status: 'ok',
      findings: this.toFindings(stats),
      data: { stats, graphPath: resolvedPath },
    }
  }

  private isGraphnetesAvailable(): boolean {
    const result = spawnSync('graphnetes', ['--help'], { encoding: 'utf-8', timeout: 5000 })
    return (result.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT'
  }

  // Returns an error string on failure, null on success.
  private buildGraph(options: ReconOptions): string | null {
    const args = ['build']
    if (options.namespace) args.push('--namespace', options.namespace)
    if (options.context) args.push('--context', options.context)

    const result = spawnSync('graphnetes', args, { encoding: 'utf-8', timeout: 60_000 })

    if (result.error) return `graphnetes build failed: ${result.error.message}`
    if (result.status !== 0) {
      return `graphnetes build exited ${result.status}: ${result.stderr?.trim() ?? ''}`
    }
    if (!existsSync(DEFAULT_GRAPH_PATH)) {
      return `graphnetes build succeeded but ${DEFAULT_GRAPH_PATH} was not created`
    }
    return null
  }

  private analyze(graph: GraphJson): TopologyStats {
    const byKind: Record<string, number> = {}
    for (const node of graph.nodes) {
      byKind[node.kind] = (byKind[node.kind] ?? 0) + 1
    }

    const outEdges = new Map<string, GraphEdge[]>()
    for (const edge of graph.edges) {
      const list = outEdges.get(edge.source) ?? []
      list.push(edge)
      outEdges.set(edge.source, list)
    }

    const ingressPaths = graph.nodes
      .filter(n => n.kind === 'Ingress')
      .map(n => ({
        ingressId: n.id,
        routesTo: (outEdges.get(n.id) ?? [])
          .filter(e => e.relation === 'routes_to')
          .map(e => e.target),
      }))

    const secretMounts: TopologyStats['secretMounts'] = []
    const serviceAccountBindings: TopologyStats['serviceAccountBindings'] = []

    for (const node of graph.nodes) {
      if (node.kind !== 'Pod') continue
      for (const edge of outEdges.get(node.id) ?? []) {
        if (edge.relation === 'mounts' && edge.target.startsWith('Secret/')) {
          secretMounts.push({ podId: node.id, secretId: edge.target })
        }
        if (edge.relation === 'uses_service_account') {
          serviceAccountBindings.push({ podId: node.id, serviceAccountId: edge.target })
        }
      }
    }

    return { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, byKind, ingressPaths, secretMounts, serviceAccountBindings }
  }

  private toFindings(stats: TopologyStats): ReconFinding[] {
    const findings: ReconFinding[] = []

    const kindSummary = Object.entries(stats.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')

    findings.push({
      severity: 'INFO',
      title: `Topology mapped: ${stats.nodeCount} nodes, ${stats.edgeCount} edges`,
      detail: kindSummary || 'No resources found',
    })

    const exposedIngresses = stats.ingressPaths.filter(p => p.routesTo.length > 0)
    if (exposedIngresses.length > 0) {
      findings.push({
        severity: 'INFO',
        title: `${exposedIngresses.length} Ingress resource(s) routing to backend Services`,
        detail: exposedIngresses.map(p => `${p.ingressId} → ${p.routesTo.join(', ')}`).join('; '),
      })
    }

    if (stats.secretMounts.length > 0) {
      const truncated = stats.secretMounts.slice(0, 10).map(m => `${m.podId} mounts ${m.secretId}`)
      if (stats.secretMounts.length > 10) truncated.push(`+${stats.secretMounts.length - 10} more`)
      findings.push({
        severity: stats.secretMounts.length > 5 ? 'WARN' : 'INFO',
        title: `${stats.secretMounts.length} Pod→Secret mount(s) detected`,
        detail: truncated.join('; '),
      })
    }

    if (stats.serviceAccountBindings.length > 0) {
      const truncated = stats.serviceAccountBindings.slice(0, 10).map(b => `${b.podId} → ${b.serviceAccountId}`)
      if (stats.serviceAccountBindings.length > 10) truncated.push(`+${stats.serviceAccountBindings.length - 10} more`)
      findings.push({
        severity: 'INFO',
        title: `${stats.serviceAccountBindings.length} Pod(s) bound to a ServiceAccount`,
        detail: truncated.join('; '),
      })
    }

    return findings
  }
}
