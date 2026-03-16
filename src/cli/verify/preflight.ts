import type { Command } from 'commander'
import { PreflightEngine } from '../../core/preflight.js'
import { header, field, section, indent, preflightLabel, blank } from '../output.js'

const DEFAULT_NAMESPACE = 'chaosclaw-tests'

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

      if (opts.output === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(result.passed ? 0 : 3)
      }

      header('ChaosClaw Preflight')
      field('Cluster Context', result.clusterContext)
      field('Test Namespace', result.namespace)

      section('Checks')
      for (const check of result.checks) {
        const label = preflightLabel(check.status)
        indent(`${label} ${check.name}`)
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
