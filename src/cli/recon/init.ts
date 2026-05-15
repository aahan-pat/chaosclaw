// Implements "chaosclaw recon init" — creates the chaosclaw namespace and applies RBAC scoping.
import type { Command } from 'commander'
import * as k8s from '@kubernetes/client-node'
import chalk from 'chalk'
import { ReconInitEngine } from '../../core/recon/init.js'
import { header, field, section, indent, blank } from '../output.js'

export const DEFAULT_RECON_NAMESPACE = 'chaosclaw'

/**
 * Attaches the "init" subcommand to the recon command group.
 * Exit codes:
 *   0 — namespace ready (created or already existed)
 *   2 — a setup step failed and pentest cannot proceed
 */
export function registerInitCommand(recon: Command): void {
  recon
    .command('init')
    .description('Initialize the chaosclaw test namespace with RBAC scoping and resource quota')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Test namespace name', DEFAULT_RECON_NAMESPACE)
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .action(async (opts: { context?: string; namespace: string; format: string }) => {
      const kc = new k8s.KubeConfig()
      kc.loadFromDefault()
      if (opts.context) kc.setCurrentContext(opts.context)
      const clusterContext = opts.context ?? kc.getCurrentContext()

      const engine = new ReconInitEngine(kc)
      let result
      try {
        result = await engine.run({ namespace: opts.namespace, context: opts.context })
      } catch (err: unknown) {
        console.error('\nError\n  Could not initialize recon namespace:', err instanceof Error ? err.message : String(err))
        process.exit(2)
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
        process.exit(result.steps.some(s => s.status === 'failed') ? 2 : 0)
      }

      header('ChaosClaw Recon — Namespace Init')
      field('Cluster Context', clusterContext)
      field('Namespace', opts.namespace)

      if (result.alreadyExisted) {
        blank()
        console.log(chalk.yellow('Warning'))
        indent(`Namespace ${opts.namespace} already exists`)
      }

      section('Setup')
      for (const step of result.steps) {
        if (step.status === 'failed') {
          indent(`${chalk.red('[ERROR]')} ${step.name}`)
          if (step.detail) indent(step.detail, 9)
        } else if (step.status === 'already-existed') {
          indent(`${chalk.dim('[OK]')}   ${step.name}`)
        } else {
          indent(`${chalk.green('[OK]')}   ${step.name}`)
        }
      }

      const failed = result.steps.find(s => s.status === 'failed')
      if (failed) {
        blank()
        section('Error')
        indent(`Cannot initialize namespace "${opts.namespace}"`)
        if (failed.detail) indent(failed.detail, 4)
        blank()
        process.exit(2)
      }

      blank()
      section('Ready')
      indent(`All pentest activity will be confined to namespace: ${opts.namespace}`)
      blank()
      process.exit(0)
    })
}
