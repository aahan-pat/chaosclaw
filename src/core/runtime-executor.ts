// Executes runtime detection scenarios against a live Kubernetes cluster.
// Unlike the admission-based ScenarioExecutor, runtime scenarios expect the workload
// to be admitted — the signal under test is whether the runtime security tool fires
// an alert (or blocks the action) within an observation window after execution.
import * as k8s from '@kubernetes/client-node'
import type { ScenarioDefinition } from '../types/scenario.js'

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
  /** Hard timeout for the entire scenario including observation (ms) */
  timeoutMs?: number
}

/** How long to observe for an alert before giving up */
const DEFAULT_OBSERVATION_WINDOW_MS = 10_000

/** Hard ceiling for the full scenario execution including observation */
const DEFAULT_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Executes runtime detection scenarios against a live Kubernetes cluster.
 *
 * Execution flow:
 *   1. Submit the scenario manifest to the cluster (workload is expected to be admitted)
 *   2. Open an observation window and poll the RuntimeAlertSource for a correlated alert
 *   3. Translate the alert (or absence of one) into a RuntimeObservedOutcome
 *   4. Return a RuntimeExecutionResult for the ValidationEngine to assess
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
   * Injects the test namespace into the manifest before submission so all
   * resources remain isolated and attributable to this ChaosClaw run.
   *
   * The hard timeout (timeoutMs) caps the entire execution. The observation
   * window (observationWindowMs) is capped to the remaining budget after submit
   * so it never exceeds the hard ceiling.
   */
  async execute(
    scenario: ScenarioDefinition,
    options: RuntimeExecutorOptions,
  ): Promise<RuntimeExecutionResult> {
    const startedAt = new Date().toISOString()
    const observationWindowMs = options.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const manifest = this.injectNamespace(scenario.manifest, options.namespace)
    const manifestSnapshot = JSON.stringify(manifest)

    // --- Submit phase ---
    let submitResult: { createdResourceName: string; rawResponse: string }
    try {
      submitResult = await Promise.race([
        this.submitManifest(manifest, options.namespace),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs),
        ),
      ])
    } catch (err: unknown) {
      const endedAt = new Date().toISOString()
      const isTimeout = err instanceof Error && err.message === 'timeout'
      return {
        observedOutcome: isTimeout ? 'timeout' : 'api_error',
        rawResponse: this.formatError(err),
        manifestSnapshot,
        startedAt,
        endedAt,
      }
    }

    // --- Observe phase ---
    // Cap the window to whatever budget remains under the hard timeout.
    const elapsedMs = Date.now() - new Date(startedAt).getTime()
    const effectiveWindowMs = Math.min(observationWindowMs, Math.max(0, timeoutMs - elapsedMs))
    const windowStart = new Date().toISOString()

    let alert: RuntimeAlert | null
    try {
      alert = await this.observeAlert(
        options.namespace,
        'chaosclaw-test-',
        windowStart,
        effectiveWindowMs,
      )
    } catch (err: unknown) {
      return {
        observedOutcome: 'api_error',
        rawResponse: this.formatError(err),
        manifestSnapshot,
        startedAt,
        endedAt: new Date().toISOString(),
        createdResourceName: submitResult.createdResourceName,
      }
    }

    return {
      observedOutcome: this.resolveOutcome(alert, scenario.expectedOutcome.type),
      alertDetail: alert ?? undefined,
      rawResponse: submitResult.rawResponse,
      manifestSnapshot,
      startedAt,
      endedAt: new Date().toISOString(),
      createdResourceName: submitResult.createdResourceName,
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
    _expectedOutcomeType: string,
  ): RuntimeObservedOutcome {
    if (alert === null) return 'no_alert'
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
