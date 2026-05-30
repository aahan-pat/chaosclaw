import type { Command } from 'commander'
import { TopologyReconEngine, type TopologyStats } from '../../core/recon/topology.js'
import { header, field, section, indent, blank, renderReconFindings } from '../output.js'
import { DEFAULT_RECON_NAMESPACE, writeJsonToFile } from './shared.js'

export function registerTopologyCommand(recon: Command): void {
  recon
    .command('topology')
    .description('Map cluster resource topology using graphnetes: ingress paths, secret mounts, service account bindings')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Scope graph build to a namespace', DEFAULT_RECON_NAMESPACE)
    .option('--graph <path>', 'Use an existing graphnetes graph.json instead of building a new one')
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--output <path>', 'Write JSON result to file')
    .action(async (opts: {
      context?: string
      namespace: string
      graph?: string
      format: string
      output?: string
    }) => {
      // Pass an optional pre-built graph path so operators can reuse an existing survey.
      const engine = new TopologyReconEngine(opts.graph)

      let result
      try {
        result = await engine.run({ namespace: opts.namespace, context: opts.context })
      } catch (err: unknown) {
        console.error('\nError\n  Topology recon failed:', err instanceof Error ? err.message : String(err))
        process.exit(2)
      }

      if (opts.output) await writeJsonToFile(opts.output, result)

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(0)
      }

      header('ChaosClaw Recon — Cluster Topology')
      if (opts.context) field('Cluster Context', opts.context)
      field('Namespace', opts.namespace)
      if (opts.graph) field('Graph Source', opts.graph)

      // Error exits with code 2 (setup failure); skip exits with 0 (tool not found is non-fatal).
      if (result.status === 'skip' || result.status === 'error') {
        renderReconFindings(result.findings)
        blank()
        process.exit(result.status === 'error' ? 2 : 0)
      }

      // Cast the data payload to the known stats shape for rendering.
      const stats = (result.data as { stats?: TopologyStats }).stats

      if (stats) {
        // Sort resource kinds by count descending for a quick visual inventory.
        const kinds = Object.entries(stats.byKind).sort((a, b) => b[1] - a[1])
        if (kinds.length > 0) {
          section(`Resources (${stats.nodeCount} nodes, ${stats.edgeCount} edges)`)
          const row = kinds.map(([k, v]) => `${k}: ${v}`).join('    ')
          indent(row)
        }

        if (stats.ingressPaths.length > 0) {
          section('Ingress Exposure Paths')
          for (const p of stats.ingressPaths) {
            blank()
            indent(p.ingressId)
            if (p.routesTo.length > 0) {
              for (const svc of p.routesTo) indent(`→ ${svc}`, 4)
            } else {
              indent('(no routes_to edges found)', 4)
            }
          }
        }

        if (stats.secretMounts.length > 0) {
          section(`Secret Mounts (${stats.secretMounts.length})`)
          // Cap output at 20 entries to avoid flooding the terminal with very large clusters.
          for (const m of stats.secretMounts.slice(0, 20)) {
            indent(`${m.podId}  →  ${m.secretId}`)
          }
          if (stats.secretMounts.length > 20) indent(`… +${stats.secretMounts.length - 20} more`)
        }

        if (stats.serviceAccountBindings.length > 0) {
          section(`ServiceAccount Bindings (${stats.serviceAccountBindings.length})`)
          for (const b of stats.serviceAccountBindings.slice(0, 20)) {
            indent(`${b.podId}  →  ${b.serviceAccountId}`)
          }
          if (stats.serviceAccountBindings.length > 20) indent(`… +${stats.serviceAccountBindings.length - 20} more`)
        }
      }

      renderReconFindings(result.findings)

      if (opts.output) {
        section('Artifacts')
        indent(`JSON report written to: ${opts.output}`)
      }

      blank()
      process.exit(0)
    })
}
