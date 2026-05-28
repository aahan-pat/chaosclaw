// Executes runtime detection scenarios against a live Kubernetes cluster.
// Unlike the admission-based ScenarioExecutor, runtime scenarios expect the workload
// to be admitted — the signal under test is whether the runtime security tool fires
// an alert after the threat command is executed inside the running pod.
import * as k8s from '@kubernetes/client-node'
import type { RuntimeScenarioDefinition, RuntimeScenarioExecStep } from '../types/runtime-scenario.js'

// ---------------------------------------------------------------------------
// Outcome types
// ---------------------------------------------------------------------------

/**
 * All possible outcomes for a runtime detection scenario.
 * These are distinct from admission outcomes — the workload is expected to be
 * created successfully; the signal is whether the runtime tool responded.
 */
export type RuntimeObservedOutcome =
  | 'alert_fired'      // Runtime tool detected the action and emitted an alert
  | 'action_blocked'   // Runtime tool prevented the action at the syscall/process level
  | 'no_alert'         // Observation window closed with no matching alert — control gap
  | 'timeout'          // Executor gave up waiting before any outcome could be determined
  | 'api_error'        // Kubernetes API call failed before the scenario could execute

/** Full result of a single runtime scenario execution */
export interface RuntimeExecutionResult {
  observedOutcome: RuntimeObservedOutcome
  /** The alert payload from the runtime tool, if one was captured */
  alertDetail?: RuntimeAlert
  /** Raw Kubernetes API response for the workload creation step */
  rawResponse: string
  /** The manifest that was submitted to the cluster */
  manifestSnapshot: string
  startedAt: string
  endedAt: string
  /** Name of the created resource — needed by CleanupManager */
  createdResourceName?: string
}

// ---------------------------------------------------------------------------
// Alert source abstraction
// ---------------------------------------------------------------------------

/**
 * A normalised alert record produced by any supported runtime security tool.
 * Each RuntimeAlertSource adapter is responsible for translating tool-specific
 * alert formats into this shape.
 */
export interface RuntimeAlert {
  /** The tool that produced this alert (e.g. 'falco', 'tetragon', 'kubearmor') */
  source: string
  /** Rule or policy name that triggered (tool-specific label) */
  ruleName: string
  /** Namespace the event occurred in */
  namespace: string
  /** Pod name associated with the event */
  podName: string
  /** ISO timestamp from the tool's alert payload */
  triggeredAt: string
  /** Raw alert body preserved for the evidence artifact */
  raw: string
  /**
   * Whether the runtime tool blocked the action at the kernel level.
   * 'blocked' maps to action_blocked; 'detected' (default) maps to alert_fired.
   * Only enforcement-capable tools (KubeArmor, Tetragon) can emit 'blocked'.
   */
  action?: 'detected' | 'blocked'
}

/**
 * Pluggable interface for runtime security alert sources.
 * Implement one adapter per supported tool (Falco, Tetragon, KubeArmor, etc.)
 * and pass it to RuntimeScenarioExecutor at construction time.
 */
export interface RuntimeAlertSource {
  /** Human-readable name of this source, used in evidence and diagnostics */
  readonly name: string

  /**
   * Check whether this alert source is reachable and operational on the cluster.
   * Called during preflight — returning false causes runtime scenarios to be skipped.
   */
  isAvailable(): Promise<boolean>

  /**
   * Poll for alerts that match the given correlation criteria within a time window.
   * Implementations should query only alerts that arrived after windowStart and
   * that are associated with the given namespace and pod name prefix.
   *
   * @param namespace     - The test namespace ChaosClaw used for this scenario
   * @param podNamePrefix - Prefix used to correlate alerts to this specific test pod
   * @param windowStart   - ISO timestamp marking the start of the observation window
   * @param windowMs      - How long (in ms) to wait for a matching alert
   */
  pollForAlert(
    namespace: string,
    podNamePrefix: string,
    windowStart: string,
    windowMs: number,
  ): Promise<RuntimeAlert | null>
}

// ---------------------------------------------------------------------------
// Executor options
// ---------------------------------------------------------------------------

export interface RuntimeExecutorOptions {
  namespace: string
  /** How long to wait for a runtime alert before declaring no_alert (ms) */
  observationWindowMs?: number
  /** Hard timeout for the entire scenario including pod startup and observation (ms) */
  timeoutMs?: number
}

/** How long to observe for an alert before giving up */
const DEFAULT_OBSERVATION_WINDOW_MS = 10_000

/**
 * Hard ceiling for the full scenario including pod startup, exec, and observation.
 * Higher than the preventive executor default to account for pod startup time.
 */
const DEFAULT_TIMEOUT_MS = 60_000

/** How often to poll pod status while waiting for the container to become ready */
const POD_READY_POLL_INTERVAL_MS = 500

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Executes runtime detection scenarios against a live Kubernetes cluster.
 *
 * Execution flow:
 *   1. Submit the scenario manifest (pod expected to be admitted)
 *   2. Poll until the pod is Running and all containers are ready
 *   3. Exec the threat command inside the running container
 *   4. Open an observation window and poll the RuntimeAlertSource for a correlated alert
 *   5. Translate the alert (or absence of one) into a RuntimeObservedOutcome
 *
 * The exec step (3) is non-fatal: even if the command exits with an error, the
 * syscall attempt is often enough to trigger a Falco/Tetragon rule. Exec errors
 * are recorded in rawResponse and execution continues to the observe phase.
 *
 * One RuntimeAlertSource is injected at construction time. To support multiple
 * runtime tools on the same cluster, wrap them in a composite adapter or run
 * separate executor instances.
 */
export class RuntimeScenarioExecutor {
  private readonly kc: k8s.KubeConfig
  private readonly alertSource: RuntimeAlertSource

  constructor(kc: k8s.KubeConfig, alertSource: RuntimeAlertSource) {
    this.kc = kc
    this.alertSource = alertSource
  }

  /**
   * Execute a runtime detection scenario.
   * A hard timeout (timeoutMs) caps the entire execution including pod startup.
   */
  async execute(
    scenario: RuntimeScenarioDefinition,
    options: RuntimeExecutorOptions,
  ): Promise<RuntimeExecutionResult> {
    const startedAt = new Date().toISOString()
    const observationWindowMs = options.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const manifest = this.injectNamespace(scenario.manifest, options.namespace)
    const manifestSnapshot = JSON.stringify(manifest)

    const timeoutSignal = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs),
    )

    try {
      return await Promise.race([
        this.runScenario(scenario, manifest, manifestSnapshot, options.namespace, observationWindowMs, startedAt),
        timeoutSignal,
      ])
    } catch (err: unknown) {
      return {
        observedOutcome: err instanceof Error && err.message === 'timeout' ? 'timeout' : 'api_error',
        rawResponse: this.formatError(err),
        manifestSnapshot,
        startedAt,
        endedAt: new Date().toISOString(),
      }
    }
  }

  /**
   * Inner execution flow wrapped so it can be raced against the hard timeout.
   * Throws on unrecoverable errors (submit failure, pod startup failure); the
   * exec step is deliberately non-fatal.
   */
  private async runScenario(
    scenario: RuntimeScenarioDefinition,
    manifest: Record<string, unknown>,
    manifestSnapshot: string,
    namespace: string,
    observationWindowMs: number,
    startedAt: string,
  ): Promise<RuntimeExecutionResult> {
    // Phase 1: submit the pod — any API error propagates as api_error
    const submitResult = await this.submitManifest(manifest, namespace)
    const podName = submitResult.createdResourceName

    // Phase 2: wait until the container is ready to accept exec commands
    await this.waitForPodRunning(podName, namespace)

    // Phase 3: exec the threat trigger — non-fatal, record error but continue
    let execError: string | undefined
    try {
      await this.execInPod(namespace, podName, scenario.execStep)
    } catch (err: unknown) {
      execError = this.formatError(err)
    }

    // Phase 4: observe for an alert correlated to this pod
    const windowStart = new Date().toISOString()
    let alert: RuntimeAlert | null = null
    let observeError: string | undefined
    try {
      alert = await this.observeAlert(namespace, 'chaosclaw-test-', windowStart, observationWindowMs)
    } catch (err: unknown) {
      observeError = this.formatError(err)
    }

    if (observeError !== undefined) {
      return {
        observedOutcome: 'api_error',
        rawResponse: observeError,
        manifestSnapshot,
        startedAt,
        endedAt: new Date().toISOString(),
        createdResourceName: podName,
      }
    }

    return {
      observedOutcome: this.resolveOutcome(alert),
      alertDetail: alert ?? undefined,
      rawResponse: execError
        ? JSON.stringify({ status: 'created', name: podName, execError })
        : submitResult.rawResponse,
      manifestSnapshot,
      startedAt,
      endedAt: new Date().toISOString(),
      createdResourceName: podName,
    }
  }

  /**
   * Submit the scenario manifest to the Kubernetes API and return the created
   * resource name (for cleanup) and the raw API response (for evidence).
   * Admission rejection at this step is treated as api_error — runtime scenarios
   * expect the workload to be admitted.
   */
  private async submitManifest(
    manifest: Record<string, unknown>,
    namespace: string,
  ): Promise<{ createdResourceName: string; rawResponse: string }> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    const kind = manifest['kind'] as string | undefined

    if (kind === 'Pod') {
      const pod = manifest as k8s.V1Pod
      const created = await coreApi.createNamespacedPod({ namespace, body: pod })
      const name = created.metadata?.name
      if (!name) throw new Error('Pod was created but the server assigned no name')
      return {
        createdResourceName: name,
        rawResponse: JSON.stringify({ status: 'created', name }),
      }
    }

    throw new Error(`Unsupported manifest kind: ${kind ?? 'unknown'}`)
  }

  /**
   * Poll pod status until all containers are ready to accept exec commands.
   * Terminates immediately if the pod reaches a terminal phase (Failed/Succeeded)
   * before becoming ready. Runs indefinitely otherwise — the hard timeout in
   * execute() is responsible for bounding total wall time.
   */
  private async waitForPodRunning(name: string, namespace: string): Promise<void> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    for (;;) {
      const pod = await coreApi.readNamespacedPod({ name, namespace })
      const phase = pod.status?.phase
      const allReady = pod.status?.containerStatuses?.every(cs => cs.ready) ?? false
      if (phase === 'Running' && allReady) return
      if (phase === 'Failed' || phase === 'Succeeded') {
        throw new Error(`Pod ${name} entered terminal phase ${phase} before becoming ready`)
      }
      await new Promise(r => setTimeout(r, POD_READY_POLL_INTERVAL_MS))
    }
  }

  /**
   * Factory method for the Exec client. Extracted so tests can override it
   * without needing to mock the entire @kubernetes/client-node module.
   */
  protected createExec(): k8s.Exec {
    return new k8s.Exec(this.kc)
  }

  /**
   * Exec a command inside a running container via the Kubernetes exec API.
   * Resolves as soon as the status callback fires (command exited), regardless
   * of exit code — the threat-trigger intent is fulfilled once the syscall runs.
   */
  private async execInPod(
    namespace: string,
    podName: string,
    step: RuntimeScenarioExecStep,
  ): Promise<void> {
    const exec = this.createExec()
    const timeoutMs = step.timeoutMs ?? 10_000

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('exec timeout')), timeoutMs)

      exec.exec(
        namespace,
        podName,
        step.container,
        step.command,
        null,  // stdout — output not needed, only the side-effect matters
        null,  // stderr
        null,  // stdin
        false, // tty
        (_status: k8s.V1Status) => {
          clearTimeout(timer)
          resolve()
        },
      ).catch((err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }

  /**
   * Open the observation window and delegate to the alert source to poll for
   * a correlated alert. Returns the alert if one arrives, or null if the window
   * closes without a match.
   */
  private async observeAlert(
    namespace: string,
    podNamePrefix: string,
    windowStart: string,
    windowMs: number,
  ): Promise<RuntimeAlert | null> {
    return this.alertSource.pollForAlert(namespace, podNamePrefix, windowStart, windowMs)
  }

  /**
   * Translate a RuntimeAlert presence/absence into a RuntimeObservedOutcome.
   * alert_fired / action_blocked cannot be distinguished from the normalised
   * RuntimeAlert payload alone — the alert source adapter is responsible for
   * emitting a blocked-action signal if the tool supports it. For now, any
   * non-null alert maps to alert_fired and null maps to no_alert.
   */
  private resolveOutcome(
    alert: RuntimeAlert | null,
  ): RuntimeObservedOutcome {
    if (alert === null) return 'no_alert'
    if (alert.action === 'blocked') return 'action_blocked'
    return 'alert_fired'
  }

  /**
   * Inject the target namespace into the manifest and set generateName so
   * test pods get unique names that can be used for alert correlation.
   */
  private injectNamespace(
    manifest: Record<string, unknown>,
    namespace: string,
  ): Record<string, unknown> {
    const meta = (manifest['metadata'] as Record<string, unknown> | undefined) ?? {}
    return {
      ...manifest,
      metadata: { ...meta, namespace, generateName: 'chaosclaw-test-', name: undefined },
    }
  }

  /** Safely converts an unknown thrown value to a plain string for evidence logging */
  private formatError(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
  }
}
