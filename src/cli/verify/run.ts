import * as k8s from '@kubernetes/client-node'
import type { Command } from 'commander'
import { ScenarioRegistry } from '../../core/registry.js'
import { ScenarioExecutor } from '../../core/executor.js'
import { ValidationEngine } from '../../core/validator.js'
import { CleanupManager } from '../../core/cleanup.js'
import { EvidenceBuilder } from '../../core/evidence-builder.js'
import { pack, scenarios } from '../../scenarios/preventive-baseline/index.js'
import type { ScenarioDefinition } from '../../types/scenario.js'
import type { ScenarioResult } from '../../types/evidence.js'
import { header, field, section, indent, outcomeLabel, blank } from '../output.js'
import chalk from 'chalk'

const DEFAULT_NAMESPACE = 'chaosclaw-tests'
const DEFAULT_TIMEOUT_MS = 30_000

export function registerRunCommand(verify: Command): void {
  verify
    .command('run')
    .description('Run verification scenarios against the target cluster')
    .option('--pack <id>', 'Scenario pack to run')
    .option('--scenario <id>', 'Single scenario to run')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Test namespace', DEFAULT_NAMESPACE)
    .option('--output <path>', 'Write JSON evidence artifact to file')
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--timeout <ms>', 'Per-scenario timeout in milliseconds', String(DEFAULT_TIMEOUT_MS))
    .option('--fail-fast', 'Stop after first failed scenario')
    .option('--cleanup <mode>', 'Cleanup mode: always, on-success', 'always')
    .action(async (opts: {
      pack?: string
      scenario?: string
      context?: string
      namespace: string
      output?: string
      format: string
      timeout: string
      failFast?: boolean
      cleanup: string
    }) => {
      if (!opts.pack && !opts.scenario) {
        console.error('\nError\n  Missing required target: specify exactly one of --pack or --scenario')
        console.error('\nExamples')
        console.error('  chaosclaw verify run --pack preventive-baseline')
        console.error('  chaosclaw verify run --scenario deny-hostpath')
        process.exit(4)
      }
      if (opts.pack && opts.scenario) {
        console.error('\nError\n  Specify exactly one of --pack or --scenario, not both')
        process.exit(4)
      }

      const registry = buildRegistry()
      const targetScenarios = resolveScenarios(registry, opts)

      if (targetScenarios.length === 0) {
        console.error(`\nError\n  No scenarios found for ${opts.pack ? `pack "${opts.pack}"` : `scenario "${opts.scenario}"`}`)
        process.exit(4)
      }

      const kc = new k8s.KubeConfig()
      kc.loadFromDefault()
      if (opts.context) kc.setCurrentContext(opts.context)
      const clusterContext = opts.context ?? kc.getCurrentContext()

      const executor = new ScenarioExecutor(kc)
      const validator = new ValidationEngine()
      const cleanup = new CleanupManager(kc)
      const builder = new EvidenceBuilder({
        clusterContext,
        packId: opts.pack,
        packVersion: opts.pack ? '1' : undefined,
        scenarioId: opts.scenario,
        startedAt: new Date().toISOString(),
      })

      const timeoutMs = parseInt(opts.timeout, 10)

      if (opts.format !== 'json') {
        header('ChaosClaw Verification Run')
        field('Cluster Context', clusterContext)
        if (opts.pack) field('Scenario Pack', opts.pack)
        if (opts.scenario) field('Scenario', opts.scenario)
        field('Scenarios', String(targetScenarios.length))
        field('Test Namespace', opts.namespace)
        field('Cleanup', opts.cleanup)
        if (opts.failFast) field('Mode', 'fail-fast')
        section(targetScenarios.length === 1 ? 'Running Scenario' : 'Running Scenarios')
      }

      let exitCode = 0
      let notRun = 0

      for (const scenario of targetScenarios) {
        const execution = await executor.execute(scenario, { namespace: opts.namespace, timeoutMs })
        const validation = validator.validate(scenario, execution)

        const createdResources = execution.createdResourceName
          ? [{ kind: 'Pod' as const, name: execution.createdResourceName, namespace: opts.namespace }]
          : []

        const shouldCleanup = opts.cleanup === 'always' || (opts.cleanup === 'on-success' && validation.status === 'Pass')
        const cleanupResult = shouldCleanup
          ? await cleanup.cleanup(createdResources)
          : { status: 'skipped' as const, remainingResources: [] }

        const result: ScenarioResult = {
          scenarioId: scenario.id,
          version: scenario.version,
          status: validation.status,
          expectedOutcome: scenario.expectedOutcome.type.replace('_', ' '),
          observedOutcome: validation.observedOutcome,
          cleanupStatus: cleanupResult.status,
          startedAt: execution.startedAt,
          endedAt: execution.endedAt,
          rawResponse: execution.rawResponse,
          manifestSnapshot: execution.manifestSnapshot,
          likelyIssue: validation.likelyIssue,
        }

        builder.addResult(result)

        if (opts.format !== 'json') {
          indent(`${outcomeLabel(result.status)} ${scenario.id}`)
        }

        if (validation.status === 'Fail' || validation.status === 'Error') {
          exitCode = 1
          if (opts.failFast) {
            notRun = targetScenarios.length - targetScenarios.indexOf(scenario) - 1
            break
          }
        }

        if (cleanupResult.remainingResources.length > 0) {
          blank()
          console.log(chalk.yellow('[WARN] Cleanup incomplete'))
          section('Details')
          for (const r of cleanupResult.remainingResources) {
            indent(`${r.kind} ${r.name} could not be deleted automatically`)
          }
          section('Next')
          for (const r of cleanupResult.remainingResources) {
            indent(`kubectl delete ${r.kind.toLowerCase()} ${r.name} -n ${r.namespace}`)
          }
        }
      }

      const evidence = builder.build(new Date().toISOString())

      if (opts.format === 'json') {
        console.log(JSON.stringify(evidence, null, 2))
        process.exit(exitCode)
      }

      section('Summary')
      indent(`Pass:    ${evidence.summary.pass}`)
      indent(`Fail:    ${evidence.summary.fail}`)
      indent(`Error:   ${evidence.summary.error}`)
      indent(`Skipped: ${evidence.summary.skipped}`)
      if (notRun > 0) indent(`Not Run: ${notRun}`)

      const failed = evidence.results.filter(r => r.status === 'Fail')
      const errors = evidence.results.filter(r => r.status === 'Error')

      if (failed.length > 0) {
        section('Failed Scenarios')
        for (const r of failed) {
          blank()
          indent(`${r.scenarioId}`)
          indent(`Expected: ${r.expectedOutcome}`, 4)
          indent(`Observed: ${r.observedOutcome}`, 4)
          if (r.likelyIssue) indent(`Likely issue: ${r.likelyIssue}`, 4)
        }
      }

      if (errors.length > 0) {
        section('Errors')
        for (const r of errors) {
          blank()
          indent(`${r.scenarioId}`)
          if (r.errorReason) indent(`Reason: ${r.errorReason}`, 4)
        }
      }

      if (notRun > 0) {
        blank()
        section('Stopped Early')
        indent(`Execution stopped after first failed scenario because --fail-fast was enabled`)
      }

      if (opts.output) {
        await builder.writeToFile(opts.output, evidence)
        section('Artifacts')
        indent(`JSON report written to: ${opts.output}`)
      }

      if (exitCode !== 0) {
        blank()
        section('Exit Code')
        indent(String(exitCode))
      }

      blank()
      process.exit(exitCode)
    })
}

function buildRegistry(): ScenarioRegistry {
  const registry = new ScenarioRegistry()
  registry.registerPack(pack)
  for (const s of scenarios) registry.register(s)
  return registry
}

function resolveScenarios(registry: ScenarioRegistry, opts: { pack?: string; scenario?: string }): ScenarioDefinition[] {
  if (opts.pack) return registry.getScenariosForPack(opts.pack)
  if (opts.scenario) {
    const s = registry.getScenario(opts.scenario)
    return s ? [s] : []
  }
  return []
}
