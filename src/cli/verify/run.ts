// Implements the "chaosclaw verify run" command.
// Orchestrates the full scenario execution pipeline: resolve scenarios → execute →
// validate → cleanup → record evidence → print results.
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
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

/**
 * Attaches the "run" subcommand to the given parent command.
 * Exactly one of --pack or --scenario must be provided.
 * Exit codes:
 *   0 — all scenarios passed
 *   1 — one or more scenarios failed or errored
 *   4 — invalid arguments (missing/conflicting flags, unknown pack/scenario)
 */
export function registerRunCommand(verify: Command): void {
  verify
    .command('run')
    .description('Run verification scenarios against the target cluster')
    .option('--pack <id>', 'Scenario pack to run')
    .option('--scenario <id>', 'Single scenario to run')
    .option('--manifest <path>', 'Path to a Pod manifest file (YAML or JSON) to test against the cluster')
    .option('--expect <outcome>', 'Expected admission outcome when using --manifest: rejected or allowed')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Test namespace', DEFAULT_NAMESPACE)
    .option('--output <path>', 'Write JSON evidence artifact to file')
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--timeout <ms>', 'Per-scenario timeout in milliseconds', String(DEFAULT_TIMEOUT_MS))
    .option('--fail-fast', 'Stop after first failed scenario')
    .option('--cleanup <mode>', 'Cleanup mode: always, on-success', 'always')
    .option('--verbose', 'Print raw API response and manifest snapshot for each non-passing scenario')
    .action(async (opts: {
      pack?: string
      scenario?: string
      manifest?: string
      expect?: string
      context?: string
      namespace: string
      output?: string
      format: string
      timeout: string
      failFast?: boolean
      cleanup: string
      verbose?: boolean
    }) => {
      // Validate mutually exclusive targeting flags before touching the cluster
      const targetCount = [opts.pack, opts.scenario, opts.manifest].filter(Boolean).length
      if (targetCount === 0) {
        console.error('\nError\n  Missing required target: specify exactly one of --pack, --scenario, or --manifest')
        console.error('\nExamples')
        console.error('  chaosclaw verify run --pack preventive-baseline')
        console.error('  chaosclaw verify run --scenario deny-hostpath')
        console.error('  chaosclaw verify run --manifest ./my-pod.yaml --expect rejected')
        process.exit(4)
      }
      if (targetCount > 1) {
        console.error('\nError\n  Specify exactly one of --pack, --scenario, or --manifest')
        process.exit(4)
      }
      if (opts.manifest && !opts.expect) {
        console.error('\nError\n  --expect is required when using --manifest (values: rejected, allowed)')
        process.exit(4)
      }
      if (opts.manifest && opts.expect !== 'rejected' && opts.expect !== 'allowed') {
        console.error(`\nError\n  --expect must be "rejected" or "allowed", got "${opts.expect}"`)
        process.exit(4)
      }

      let targetScenarios: ScenarioDefinition[]
      if (opts.manifest) {
        targetScenarios = [await loadManifestScenario(opts.manifest, opts.expect!)]
      } else {
        const registry = buildRegistry()
        targetScenarios = resolveScenarios(registry, opts)
        if (targetScenarios.length === 0) {
          console.error(`\nError\n  No scenarios found for ${opts.pack ? `pack "${opts.pack}"` : `scenario "${opts.scenario}"`}`)
          process.exit(4)
        }
      }

      // Set up the Kubernetes client once and share it across executor, cleanup, etc.
      const kc = new k8s.KubeConfig()
      kc.loadFromDefault()
      if (opts.context) kc.setCurrentContext(opts.context)
      const clusterContext = opts.context ?? kc.getCurrentContext()

      // Ensure the test namespace exists before running any scenarios
      await ensureNamespace(kc, opts.namespace)

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

      // parseInt is safe here because commander validates the flag is present
      const timeoutMs = parseInt(opts.timeout, 10)

      if (opts.format !== 'json') {
        header('ChaosClaw Verification Run')
        field('Cluster Context', clusterContext)
        if (opts.pack) field('Scenario Pack', opts.pack)
        if (opts.scenario) field('Scenario', opts.scenario)
        if (opts.manifest) {
          field('Manifest', opts.manifest)
          field('Expect', opts.expect!)
        }
        field('Scenarios', String(targetScenarios.length))
        field('Test Namespace', opts.namespace)
        field('Cleanup', opts.cleanup)
        if (opts.failFast) field('Mode', 'fail-fast')
        if (opts.verbose) field('Verbose', 'on')
        section(targetScenarios.length === 1 ? 'Running Scenario' : 'Running Scenarios')
      }

      let exitCode = 0
      let notRun = 0

      for (const scenario of targetScenarios) {
        const execution = await executor.execute(scenario, { namespace: opts.namespace, timeoutMs })
        const validation = validator.validate(scenario, execution)

        // Only populate createdResources when the cluster actually admitted the workload
        const createdResources = execution.createdResourceName
          ? [{ kind: 'Pod' as const, name: execution.createdResourceName, namespace: opts.namespace }]
          : []

        // Respect --cleanup mode: skip deletion when on-success and the scenario failed
        const shouldCleanup = opts.cleanup === 'always' || (opts.cleanup === 'on-success' && validation.status === 'Pass')
        const cleanupResult = shouldCleanup
          ? await cleanup.cleanup(createdResources)
          : { status: 'skipped' as const, remainingResources: [] }

        const result: ScenarioResult = {
          scenarioId: scenario.id,
          version: scenario.version,
          status: validation.status,
          // Replace underscore with space for human-readable output
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
          if (opts.verbose && (result.status === 'Fail' || result.status === 'Error')) {
            if (result.likelyIssue) indent(`Likely issue:      ${result.likelyIssue}`, 4)
            if (result.rawResponse) indent(`Raw response:      ${result.rawResponse}`, 4)
            if (result.manifestSnapshot) indent(`Manifest snapshot: ${result.manifestSnapshot}`, 4)
          }
        }

        if (validation.status === 'Fail' || validation.status === 'Error') {
          exitCode = 1
          if (opts.failFast) {
            // Calculate how many scenarios were skipped due to early exit
            notRun = targetScenarios.length - targetScenarios.indexOf(scenario) - 1
            break
          }
        }

        // Warn the user immediately when cleanup fails so they can act before the next scenario
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

      // JSON mode: print the full evidence document and exit without further output
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

/** Populate a fresh registry with the built-in preventive-baseline pack and its scenarios */
function buildRegistry(): ScenarioRegistry {
  const registry = new ScenarioRegistry()
  registry.registerPack(pack)
  for (const s of scenarios) registry.register(s)
  return registry
}

/**
 * Translate --pack / --scenario CLI flags into a concrete list of ScenarioDefinitions.
 * Returns an empty array when the requested pack or scenario ID is not found.
 */
function resolveScenarios(registry: ScenarioRegistry, opts: { pack?: string; scenario?: string }): ScenarioDefinition[] {
  if (opts.pack) return registry.getScenariosForPack(opts.pack)
  if (opts.scenario) {
    const s = registry.getScenario(opts.scenario)
    return s ? [s] : []
  }
  return []
}

/**
 * Reads a user-supplied Pod manifest file (YAML or JSON), validates it, and wraps it
 * in a synthetic ScenarioDefinition so it can flow through the standard execution pipeline.
 * Exits with code 4 on any file, parse, or validation error.
 */
async function loadManifestScenario(manifestPath: string, expect: string): Promise<ScenarioDefinition> {
  let content: string
  try {
    content = await readFile(manifestPath, 'utf-8')
  } catch {
    console.error(`\nError\n  Could not read manifest file: ${manifestPath}`)
    process.exit(4)
  }

  let parsed: unknown
  try {
    parsed = k8s.loadYaml(content)
  } catch {
    console.error(`\nError\n  Could not parse manifest file (expected valid YAML or JSON): ${manifestPath}`)
    process.exit(4)
  }

  if (!parsed || typeof parsed !== 'object') {
    console.error(`\nError\n  Manifest file is empty or not a valid object: ${manifestPath}`)
    process.exit(4)
  }

  const manifest = parsed as Record<string, unknown>

  if (manifest['kind'] !== 'Pod') {
    console.error(`\nError\n  Only Pod manifests are supported. Found kind: ${manifest['kind'] ?? 'unknown'}`)
    console.error('  Tip: extract the pod template from a Deployment/DaemonSet into a standalone Pod manifest')
    process.exit(4)
  }

  return {
    id: `custom:${basename(manifestPath)}`,
    version: 1,
    name: basename(manifestPath),
    description: 'User-submitted manifest',
    category: 'preventive',
    controlObjective: 'User-defined',
    prerequisites: [],
    manifest,
    expectedOutcome: { type: expect === 'rejected' ? 'admission_rejected' : 'admission_allowed' },
    cleanup: { deleteCreatedResources: true },
    safety: { level: 'low', namespaceScoped: true },
  }
}

/**
 * Creates the test namespace if it does not already exist.
 * Idempotent: a 409 Conflict response (namespace already exists) is silently ignored.
 */
async function ensureNamespace(kc: k8s.KubeConfig, namespace: string): Promise<void> {
  const coreApi = kc.makeApiClient(k8s.CoreV1Api)
  try {
    await coreApi.createNamespace({ apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace } })
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode
    if (status !== 409) throw err
  }
}
