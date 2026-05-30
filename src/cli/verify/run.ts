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
import { RuntimeScenarioExecutor } from '../../core/runtime-executor.js'
import { RuntimeValidationEngine } from '../../core/runtime-validator.js'
import { buildAlertSource } from '../../core/alert-sources/index.js'
import { CleanupManager } from '../../core/cleanup.js'
import { EvidenceBuilder } from '../../core/evidence-builder.js'
import { pack as preventivePack, scenarios as preventiveScenarios } from '../../scenarios/preventive-baseline/index.js'
import { pack as runtimePack, scenarios as runtimeScenarios } from '../../scenarios/runtime-baseline/index.js'
import type { ScenarioDefinition } from '../../types/scenario.js'
import type { RuntimeScenarioDefinition } from '../../types/runtime-scenario.js'
import type { ScenarioResult } from '../../types/evidence.js'
import { header, field, section, indent, outcomeLabel, blank } from '../output.js'
import chalk from 'chalk'

const DEFAULT_NAMESPACE = 'chaosclaw-tests'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RUNTIME_TIMEOUT_MS = 60_000

type AnyScenario = ScenarioDefinition | RuntimeScenarioDefinition

// Distinguish runtime scenarios from preventive ones by the presence of the execStep field.
function isRuntimeScenario(s: AnyScenario): s is RuntimeScenarioDefinition {
  return 'execStep' in s
}

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
    .option('--alert-source <tool>', 'Runtime alert source: none (default), falco, tetragon, kubearmor', 'none')
    .option('--output <path>', 'Write JSON evidence artifact to file')
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--timeout <ms>', 'Per-scenario timeout in milliseconds')
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
      alertSource: string
      output?: string
      format: string
      timeout?: string
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
        console.error('  chaosclaw verify run --pack runtime-baseline --alert-source none')
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

      // Resolve the target scenario list from either a manifest file or the built-in registries.
      let targetScenarios: AnyScenario[]
      if (opts.manifest) {
        targetScenarios = [await loadManifestScenario(opts.manifest, opts.expect!)]
      } else {
        targetScenarios = resolveScenarios(opts)
        if (targetScenarios.length === 0) {
          console.error(`\nError\n  No scenarios found for ${opts.pack ? `pack "${opts.pack}"` : `scenario "${opts.scenario}"`}`)
          process.exit(4)
        }
      }

      // Check whether any scenarios require the runtime execution path.
      const hasRuntime = targetScenarios.some(isRuntimeScenario)

      if (hasRuntime && opts.alertSource === 'none' && opts.format !== 'json') {
        console.log(chalk.yellow('\n[WARN] No alert source configured (--alert-source none)'))
        console.log(chalk.yellow('       Runtime scenarios will execute but all observed outcomes will be "no_alert".'))
        console.log(chalk.yellow('       Use --alert-source falco, tetragon, or kubearmor to poll a real detection tool.\n'))
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
      // Only instantiate the runtime executor when the scenario set includes detection scenarios.
      const runtimeExecutor = hasRuntime ? new RuntimeScenarioExecutor(kc, buildAlertSource(opts.alertSource, kc)) : null
      const runtimeValidator = new RuntimeValidationEngine()
      const cleanup = new CleanupManager(kc)
      const builder = new EvidenceBuilder({
        clusterContext,
        packId: opts.pack,
        packVersion: opts.pack ? '1' : undefined,
        scenarioId: opts.scenario,
        startedAt: new Date().toISOString(),
      })

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
        if (hasRuntime) field('Alert Source', opts.alertSource)
        if (opts.failFast) field('Mode', 'fail-fast')
        if (opts.verbose) field('Verbose', 'on')
        section(targetScenarios.length === 1 ? 'Running Scenario' : 'Running Scenarios')
      }

      let exitCode = 0
      let notRun = 0

      for (const scenario of targetScenarios) {
        let result: ScenarioResult

        if (isRuntimeScenario(scenario)) {
          // Use the runtime executor for scenarios that require pod exec and alert observation.
          const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : DEFAULT_RUNTIME_TIMEOUT_MS
          const execution = await runtimeExecutor!.execute(scenario, { namespace: opts.namespace, timeoutMs })
          const validation = runtimeValidator.validate(scenario, execution)

          // Only track cleanup targets for pods that were actually admitted to the cluster.
          const createdResources = execution.createdResourceName
            ? [{ kind: 'Pod' as const, name: execution.createdResourceName, namespace: opts.namespace }]
            : []

          const shouldCleanup = opts.cleanup === 'always' || (opts.cleanup === 'on-success' && validation.status === 'Pass')
          const cleanupResult = shouldCleanup
            ? await cleanup.cleanup(createdResources)
            : { status: 'skipped' as const, remainingResources: [] }

          result = {
            scenarioId: scenario.id,
            version: scenario.version,
            status: validation.status,
            expectedOutcome: scenario.expectedOutcome.type.replace('_', ' '),
            observedOutcome: validation.observedOutcome,
            cleanupStatus: cleanupResult.status,
            startedAt: execution.startedAt,
            endedAt: execution.endedAt,
            // Prefer the structured alert payload over the raw response when an alert was captured.
            rawResponse: execution.alertDetail
              ? JSON.stringify(execution.alertDetail)
              : execution.rawResponse,
            manifestSnapshot: execution.manifestSnapshot,
            likelyIssue: validation.likelyIssue,
          }

          printCleanupWarning(cleanupResult)
        } else {
          // Use the admission-based executor for preventive scenarios.
          const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : DEFAULT_TIMEOUT_MS
          const execution = await executor.execute(scenario, { namespace: opts.namespace, timeoutMs })
          const validation = validator.validate(scenario, execution)

          const createdResources = execution.createdResourceName
            ? [{ kind: 'Pod' as const, name: execution.createdResourceName, namespace: opts.namespace }]
            : []

          const shouldCleanup = opts.cleanup === 'always' || (opts.cleanup === 'on-success' && validation.status === 'Pass')
          const cleanupResult = shouldCleanup
            ? await cleanup.cleanup(createdResources)
            : { status: 'skipped' as const, remainingResources: [] }

          result = {
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

          printCleanupWarning(cleanupResult)
        }

        builder.addResult(result)

        if (opts.format !== 'json') {
          indent(`${outcomeLabel(result.status)} ${scenario.id}`)
          // In verbose mode, print extra diagnostic detail for non-passing scenarios.
          if (opts.verbose && (result.status === 'Fail' || result.status === 'Error')) {
            if (result.likelyIssue) indent(`Likely issue:      ${result.likelyIssue}`, 4)
            if (result.rawResponse) indent(`Raw response:      ${result.rawResponse}`, 4)
            if (result.manifestSnapshot) indent(`Manifest snapshot: ${result.manifestSnapshot}`, 4)
          }
        }

        if (result.status === 'Fail' || result.status === 'Error') {
          exitCode = 1
          // In fail-fast mode, record how many scenarios were skipped and stop iterating.
          if (opts.failFast) {
            notRun = targetScenarios.length - targetScenarios.indexOf(scenario) - 1
            break
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


/** Populate a fresh registry with all built-in packs and scenarios */
function buildRegistry(): { preventive: ScenarioRegistry; runtime: Map<string, RuntimeScenarioDefinition>; runtimePacks: Map<string, string[]> } {
  // Register all preventive scenarios and the pack that groups them.
  const preventive = new ScenarioRegistry()
  preventive.registerPack(preventivePack)
  for (const s of preventiveScenarios) preventive.register(s)

  // Runtime scenarios use a plain Map because ScenarioRegistry is typed for preventive definitions.
  const runtime = new Map<string, RuntimeScenarioDefinition>()
  for (const s of runtimeScenarios) runtime.set(s.id, s)

  // Store runtime pack membership separately so resolveScenarios can look up pack contents.
  const runtimePacks = new Map<string, string[]>()
  runtimePacks.set(runtimePack.id, runtimePack.scenarioIds)

  return { preventive, runtime, runtimePacks }
}

/**
 * Translate --pack / --scenario CLI flags into a concrete list of scenarios
 * drawn from both the preventive and runtime registries.
 */
function resolveScenarios(opts: { pack?: string; scenario?: string }): AnyScenario[] {
  const { preventive, runtime, runtimePacks } = buildRegistry()

  if (opts.pack) {
    // Combine preventive and runtime scenarios for mixed-type packs.
    const preventiveResults = preventive.getScenariosForPack(opts.pack)
    const runtimeIds = runtimePacks.get(opts.pack) ?? []
    const runtimeResults = runtimeIds.map(id => runtime.get(id)).filter((s): s is RuntimeScenarioDefinition => s !== undefined)
    return [...preventiveResults, ...runtimeResults]
  }

  if (opts.scenario) {
    // Check the preventive registry first, then fall back to the runtime map.
    const p = preventive.getScenario(opts.scenario)
    if (p) return [p]
    const r = runtime.get(opts.scenario)
    if (r) return [r]
    return []
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
    // Accept both YAML and JSON by delegating to the Kubernetes client's parser.
    parsed = k8s.loadYaml(content)
  } catch {
    console.error(`\nError\n  Could not parse manifest file (expected valid YAML or JSON): ${manifestPath}`)
    process.exit(4)
  }

  if (!parsed || typeof parsed !== 'object') {
    console.error(`\nError\n  Manifest file is empty or not a valid object: ${manifestPath}`)
    process.exit(4)
  }

  // Enforce Pod-only constraint since the executor only supports Pod creation.
  const manifest = parsed as Record<string, unknown>

  if (manifest['kind'] !== 'Pod') {
    console.error(`\nError\n  Only Pod manifests are supported. Found kind: ${manifest['kind'] ?? 'unknown'}`)
    console.error('  Tip: extract the pod template from a Deployment/DaemonSet into a standalone Pod manifest')
    process.exit(4)
  }

  // Wrap the manifest in a minimal ScenarioDefinition so the standard run pipeline can execute it.
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
    await coreApi.createNamespace({ body: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace } } })
  } catch (err: unknown) {
    // A 409 means the namespace already exists — that is the desired state, so swallow the error.
    const code = (err as { code?: number; statusCode?: number }).code ?? (err as { statusCode?: number }).statusCode
    if (code !== 409) throw err
  }
}

// Print a cleanup warning with kubectl delete commands when resources could not be removed.
function printCleanupWarning(cleanupResult: { remainingResources: Array<{ kind: string; name: string; namespace: string }> }): void {
  if (cleanupResult.remainingResources.length === 0) return
  blank()
  console.log(chalk.yellow('[WARN] Cleanup incomplete'))
  section('Details')
  for (const r of cleanupResult.remainingResources) {
    indent(`${r.kind} ${r.name} could not be deleted automatically`)
  }
  // Provide ready-to-run kubectl commands so operators can clean up manually.
  section('Next')
  for (const r of cleanupResult.remainingResources) {
    indent(`kubectl delete ${r.kind.toLowerCase()} ${r.name} -n ${r.namespace}`)
  }
}
