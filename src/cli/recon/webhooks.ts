import type { Command } from 'commander'
import { WebhookReconEngine, type WebhookInfo } from '../../core/recon/webhooks.js'
import { header, field, section, indent, blank, renderReconFindings } from '../output.js'
import { buildKubeConfig, DEFAULT_RECON_NAMESPACE, writeJsonToFile } from './shared.js'
import chalk from 'chalk'

export function registerWebhooksCommand(recon: Command): void {
  recon
    .command('webhooks')
    .description('Survey admission webhooks and detect failure-open configurations')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Recon namespace', DEFAULT_RECON_NAMESPACE)
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--output <path>', 'Write JSON result to file')
    .option('--verbose', 'Show all webhook rule detail')
    .action(async (opts: { context?: string; namespace: string; format: string; output?: string; verbose?: boolean }) => {
      // Build the KubeConfig once and share it with the engine.
      const { kc, clusterContext } = buildKubeConfig(opts.context)
      const engine = new WebhookReconEngine(kc)

      let result
      try {
        result = await engine.run({ namespace: opts.namespace, context: opts.context, verbose: opts.verbose })
      } catch (err: unknown) {
        console.error('\nError\n  Webhook recon failed:', err instanceof Error ? err.message : String(err))
        process.exit(2)
      }

      // Persist the JSON result before deciding which output format to render.
      if (opts.output) await writeJsonToFile(opts.output, result)

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(0)
      }

      header('ChaosClaw Recon — Admission Webhooks')
      field('Cluster Context', clusterContext)

      // On skip/error, show whatever findings were collected and exit cleanly.
      if (result.status === 'skip' || result.status === 'error') {
        renderReconFindings(result.findings)
        blank()
        process.exit(0)
      }

      // Separate webhooks into validating and mutating sections for clearer output.
      const webhooks = (result.data as { webhooks?: WebhookInfo[] }).webhooks ?? []
      const validating = webhooks.filter(w => w.type === 'validating')
      const mutating = webhooks.filter(w => w.type === 'mutating')

      if (validating.length > 0) {
        section(`Validating Webhooks (${validating.length})`)
        for (const wh of validating) {
          // Highlight failure-open webhooks inline so they stand out immediately.
          const failMark = wh.failurePolicy === 'Ignore' ? chalk.yellow('  ← fails open') : ''
          blank()
          indent(wh.name)
          indent(`Rules: ${wh.ruleCount}    Failure policy: ${wh.failurePolicy}    Scope: ${wh.scope}${failMark}`, 4)
        }
      }

      if (mutating.length > 0) {
        section(`Mutating Webhooks (${mutating.length})`)
        for (const wh of mutating) {
          blank()
          indent(wh.name)
          indent(`Rules: ${wh.ruleCount}    Failure policy: ${wh.failurePolicy}    Scope: ${wh.scope}`, 4)
        }
      }

      if (webhooks.length === 0) {
        section('Admission Webhooks')
        indent('None found')
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
