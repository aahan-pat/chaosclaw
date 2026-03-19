// Implements the "chaosclaw verify preflight" command.
// Delegates cluster readiness checks to PreflightEngine and formats the result
// as either a human-readable table or raw JSON for CI consumers.
import type { Command } from 'commander'
import { PreflightEngine } from '../../core/preflight.js'
import { header, field, section, indent, preflightLabel, blank } from '../output.js'

const DEFAULT_NAMESPACE = 'chaosclaw-tests'

/**
 * Attaches the "preflight" subcommand to the given parent command.
 * Exit codes:
 *   0 — all checks passed (warnings allowed)
 *   2 — unexpected error prevented checks from running
 *   3 — one or more checks failed
 */
export function registerPreflightCommand(verify: Command): void {
  verify
    .command('preflight')
    .description('Check that the target cluster is ready for verification')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Test namespace', DEFAULT_NAMESPACE)
    .option('--output <format>', 'Output format: table, json', 'table')
    .action(async (opts: { context?: string; namespace: string; output: string }) => {
      const engine = new PreflightEngine()

      let result
      try {
        result = await engine.run({ context: opts.context, namespace: opts.namespace })
      } catch (err: unknown) {
        console.error('Error running preflight:', err instanceof Error ? err.message : String(err))
        process.exit(2)
      }

      // JSON mode: emit the raw result object and exit; no further formatting
      if (opts.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(result.passed ? 0 : 3)
      }

      // Table mode: print a human-readable summary
      header('ChaosClaw Preflight')
      field('Cluster Context', result.clusterContext)
      field('Test Namespace', result.namespace)

      section('Checks')
      for (const check of result.checks) {
        const label = preflightLabel(check.status)
        indent(`${label} ${check.name}`)
        // Indent failure/warning detail one level deeper for visual hierarchy
        if (check.detail) indent(`  ${check.detail}`, 4)
      }

      section('Result')
      if (!result.passed) {
        indent('Preflight failed')
      } else if (result.hasWarnings) {
        indent('Preflight passed with warnings')
      } else {
        indent('Preflight passed')
      }

      // Only show the "Next" prompt when the cluster is ready to run scenarios
      if (result.passed) {
        blank()
        section('Next')
        const contextFlag = opts.context ? ` --context ${opts.context}` : ''
        indent(`chaosclaw verify run --pack preventive-baseline${contextFlag}`)
      }

      blank()
      process.exit(result.passed ? 0 : 3)
    })
}
