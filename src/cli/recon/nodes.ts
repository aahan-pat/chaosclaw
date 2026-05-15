import type { Command } from 'commander'
import { NodeReconEngine, type NodeInfo } from '../../core/recon/nodes.js'
import { header, field, section, indent, blank, renderReconFindings } from '../output.js'
import { buildKubeConfig, DEFAULT_RECON_NAMESPACE, writeJsonToFile } from './shared.js'

export function registerNodesCommand(recon: Command): void {
  recon
    .command('nodes')
    .description('Survey node security posture: kernel, container runtime, AppArmor and seccomp')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Recon namespace', DEFAULT_RECON_NAMESPACE)
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--output <path>', 'Write JSON result to file')
    .option('--verbose', 'Show full node detail')
    .action(async (opts: { context?: string; namespace: string; format: string; output?: string; verbose?: boolean }) => {
      const { kc, clusterContext } = buildKubeConfig(opts.context)
      const engine = new NodeReconEngine(kc)

      let result
      try {
        result = await engine.run({ namespace: opts.namespace, context: opts.context, verbose: opts.verbose })
      } catch (err: unknown) {
        console.error('\nError\n  Node recon failed:', err instanceof Error ? err.message : String(err))
        process.exit(2)
      }

      if (opts.output) await writeJsonToFile(opts.output, result)

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(0)
      }

      header('ChaosClaw Recon — Node Security Posture')
      field('Cluster Context', clusterContext)

      if (result.status === 'skip' || result.status === 'error') {
        renderReconFindings(result.findings)
        blank()
        process.exit(0)
      }

      const nodes = (result.data as { nodes?: NodeInfo[] }).nodes ?? []
      section(`Nodes (${nodes.length})`)
      for (const node of nodes) {
        blank()
        indent(node.name)
        indent(`OS: ${node.os}    Kernel: ${node.kernel}`, 4)
        indent(`Runtime: ${node.runtime}    Seccomp: ${node.seccompDefault}`, 4)
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
