import type { Command } from 'commander'
import { PolicyReconEngine, type PolicyInfo, type PolicyEngine } from '../../core/recon/policies.js'
import { header, field, section, indent, blank, renderReconFindings } from '../output.js'
import { buildKubeConfig, DEFAULT_RECON_NAMESPACE, writeJsonToFile } from './shared.js'
import chalk from 'chalk'

export function registerPoliciesCommand(recon: Command): void {
  recon
    .command('policies')
    .description('Detect policy engine (Kyverno / Gatekeeper) and survey enforcement modes')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Recon namespace', DEFAULT_RECON_NAMESPACE)
    .option('--engine <name>', 'Force a specific engine: kyverno, gatekeeper, auto', 'auto')
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--output <path>', 'Write JSON result to file')
    .action(async (opts: { context?: string; namespace: string; engine: string; format: string; output?: string }) => {
      const { kc, clusterContext } = buildKubeConfig(opts.context)
      const engine = new PolicyReconEngine(kc)

      let result
      try {
        result = await engine.run({
          namespace: opts.namespace,
          context: opts.context,
          engine: opts.engine,
        })
      } catch (err: unknown) {
        console.error('\nError\n  Policy recon failed:', err instanceof Error ? err.message : String(err))
        process.exit(2)
      }

      if (opts.output) await writeJsonToFile(opts.output, result)

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(0)
      }

      header('ChaosClaw Recon — Policy Engine')
      field('Cluster Context', clusterContext)

      if (result.status === 'skip' || result.status === 'error') {
        renderReconFindings(result.findings)
        blank()
        process.exit(0)
      }

      // Cast the opaque data field to its known shape for display.
      const data = result.data as { engine?: PolicyEngine; policies?: PolicyInfo[] }
      const detectedEngine = data.engine ?? 'none'
      const policies = data.policies ?? []

      section('Detection')
      if (detectedEngine === 'none') {
        indent('No policy engine detected')
      } else {
        indent(`Engine: ${detectedEngine}`)
        indent(`Policies: ${policies.length}`)
      }

      if (policies.length > 0) {
        // Use engine-specific terminology for the section heading to match the Kubernetes resource names.
        section(`${detectedEngine === 'kyverno' ? 'ClusterPolicies' : 'ConstraintTemplates'} (${policies.length})`)
        for (const p of policies) {
          const action = p.validationFailureAction
          // Mark audit-only policies inline so operators can immediately see which ones don't enforce.
          const mark = action?.toLowerCase() === 'audit' ? chalk.yellow('  ← audit only') : ''
          const actionDisplay = action ? `${action.padEnd(12)}` : '—'.padEnd(12)
          indent(`${p.name.padEnd(40)} ${actionDisplay}${mark}`)
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
