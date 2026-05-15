import type { Command } from 'commander'
import { NetworkPolicyReconEngine, type NamespaceNetworkStatus } from '../../core/recon/network-policies.js'
import { header, field, section, indent, blank, renderReconFindings } from '../output.js'
import { buildKubeConfig, DEFAULT_RECON_NAMESPACE, writeJsonToFile } from './shared.js'

export function registerNetworkPoliciesCommand(recon: Command): void {
  recon
    .command('network-policies')
    .description('Survey NetworkPolicy coverage across all user namespaces')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Recon namespace', DEFAULT_RECON_NAMESPACE)
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--output <path>', 'Write JSON result to file')
    .action(async (opts: { context?: string; namespace: string; format: string; output?: string }) => {
      const { kc, clusterContext } = buildKubeConfig(opts.context)
      const engine = new NetworkPolicyReconEngine(kc)

      let result
      try {
        result = await engine.run({ namespace: opts.namespace, context: opts.context })
      } catch (err: unknown) {
        console.error('\nError\n  Network policy recon failed:', err instanceof Error ? err.message : String(err))
        process.exit(2)
      }

      if (opts.output) await writeJsonToFile(opts.output, result)

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(0)
      }

      header('ChaosClaw Recon — Network Policies')
      field('Cluster Context', clusterContext)

      if (result.status === 'skip' || result.status === 'error') {
        renderReconFindings(result.findings)
        blank()
        process.exit(0)
      }

      const namespaces = (result.data as { namespaces?: NamespaceNetworkStatus[] }).namespaces ?? []
      const withPolicies = namespaces.filter(n => n.policyCount > 0)
      const withoutPolicies = namespaces.filter(n => n.policyCount === 0)

      if (withPolicies.length > 0) {
        section('Namespaces with policies')
        for (const ns of withPolicies) {
          const coverage = [
            ns.hasIngress ? 'ingress' : null,
            ns.hasEgress ? 'egress' : null,
          ].filter(Boolean).join(' + ')
          indent(`${ns.namespace}    ${ns.policyCount} policies    ${coverage}`)
        }
      }

      if (withoutPolicies.length > 0) {
        section('Namespaces without policies')
        for (const ns of withoutPolicies) {
          indent(`${ns.namespace}`)
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
