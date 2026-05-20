// Implements "chaosclaw verify network" — the reachability primitive.
// Submits a pod, probes a target endpoint from inside it, and reports whether
// the target was reachable. Optionally polls a runtime detection tool.
//
// The pod image must include the probe tool for the chosen protocol:
//   http/https → curl    tcp → nc (netcat)
// OpenClaw controls the image via the pod manifest.
import { basename } from 'node:path'
import * as k8s from '@kubernetes/client-node'
import type { Command } from 'commander'
import {
  loadPodManifest, resolveFirstContainer, injectNamespace,
  ensureNamespace, submitPod, waitForPodRunning, execCapturing,
} from '../../core/pod-runner.js'
import { buildAlertSource } from '../../core/alert-sources/index.js'
import { CleanupManager } from '../../core/cleanup.js'
import { EvidenceBuilder } from '../../core/evidence-builder.js'
import { header, field, section, indent, outcomeLabel, blank } from '../output.js'
import chalk from 'chalk'

const DEFAULT_NAMESPACE = 'chaosclaw-tests'
const DEFAULT_POD_TIMEOUT_S = 60
const DEFAULT_CONNECT_TIMEOUT_S = 5
const DEFAULT_OBSERVATION_WINDOW_S = 10

const VALID_PROTOCOLS = ['http', 'https', 'tcp'] as const
type Protocol = (typeof VALID_PROTOCOLS)[number]

const VALID_EXPECTS = ['reachable', 'unreachable'] as const
type NetworkExpect = (typeof VALID_EXPECTS)[number]

export function registerNetworkCommand(verify: Command): void {
  verify
    .command('network')
    .description('Submit a pod and probe a target endpoint from inside it')
    .requiredOption('--from <path>', 'Pod manifest to use as the network source (YAML or JSON)')
    .requiredOption('--target <url|host:port>', 'Endpoint to probe (e.g. http://169.254.169.254/, 10.0.0.1:2379)')
    .option('--protocol <proto>', 'Protocol: http, https, tcp (default: inferred from target)')
    .option('--container <name>', 'Container to exec into (default: first container in the pod spec)')
    .requiredOption('--expect <outcome>', 'Expected outcome: reachable, unreachable')
    .option('--alert-source <tool>', 'Also poll this runtime tool for a correlated alert: none (default), falco, tetragon, kubearmor', 'none')
    .option('--observation-window <seconds>', `Alert poll window when using --alert-source (default: ${DEFAULT_OBSERVATION_WINDOW_S})`, String(DEFAULT_OBSERVATION_WINDOW_S))
    .option('--connect-timeout <seconds>', `TCP connect timeout for the probe (default: ${DEFAULT_CONNECT_TIMEOUT_S})`, String(DEFAULT_CONNECT_TIMEOUT_S))
    .option('--pod-timeout <seconds>', `Max wait for pod Running (default: ${DEFAULT_POD_TIMEOUT_S})`, String(DEFAULT_POD_TIMEOUT_S))
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Test namespace', DEFAULT_NAMESPACE)
    .option('--output <path>', 'Write JSON evidence artifact to file')
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--cleanup <mode>', 'Cleanup mode: always, on-success', 'always')
    .action(async (opts: {
      from: string
      target: string
      protocol?: string
      container?: string
      expect: string
      alertSource: string
      observationWindow: string
      connectTimeout: string
      podTimeout: string
      context?: string
      namespace: string
      output?: string
      format: string
      cleanup: string
    }) => {
      if (!VALID_EXPECTS.includes(opts.expect as NetworkExpect)) {
        console.error(`\nError\n  --expect must be one of: ${VALID_EXPECTS.join(', ')}. Got: "${opts.expect}"`)
        process.exit(4)
      }

      const protocol = resolveProtocol(opts.target, opts.protocol)
      if (!VALID_PROTOCOLS.includes(protocol as Protocol)) {
        console.error(`\nError\n  --protocol must be one of: ${VALID_PROTOCOLS.join(', ')}. Got: "${opts.protocol}"`)
        process.exit(4)
      }

      const manifest = await loadPodManifest(opts.from)
      const container = opts.container ?? resolveFirstContainer(manifest)
      if (!container) {
        console.error('\nError\n  Could not determine container name — specify --container or ensure the pod spec includes named containers')
        process.exit(4)
      }

      const connectTimeoutS = parseInt(opts.connectTimeout, 10)
      const probeCommand = buildProbeCommand(opts.target, protocol as Protocol, connectTimeoutS)

      const kc = new k8s.KubeConfig()
      kc.loadFromDefault()
      if (opts.context) kc.setCurrentContext(opts.context)
      const clusterContext = opts.context ?? kc.getCurrentContext()

      await ensureNamespace(kc, opts.namespace)

      const podTimeoutMs = parseInt(opts.podTimeout, 10) * 1_000
      const observationWindowMs = parseInt(opts.observationWindow, 10) * 1_000
      // Exec timeout: connect timeout + 5s overhead for curl/nc startup
      const execTimeoutMs = (connectTimeoutS + 5) * 1_000
      const alertSource = buildAlertSource(opts.alertSource, kc)
      const cleanup = new CleanupManager(kc)
      const builder = new EvidenceBuilder({ clusterContext, startedAt: new Date().toISOString() })
      const startedAt = new Date().toISOString()
      const scenarioId = `network:${basename(opts.from)}→${opts.target}`

      if (opts.format !== 'json') {
        header('ChaosClaw Network')
        field('Cluster Context', clusterContext)
        field('Source Pod', opts.from)
        field('Target', opts.target)
        field('Protocol', protocol)
        field('Expect', opts.expect)
        if (opts.alertSource !== 'none') field('Alert Source', opts.alertSource)
        field('Test Namespace', opts.namespace)
        section('Running')
      }

      const injected = injectNamespace(manifest, opts.namespace)
      let podName: string | undefined
      let observedOutcome: string
      let likelyIssue: string | undefined
      let rawResponse: string
      let alertJson: string | undefined

      try {
        podName = await submitPod(kc, opts.namespace, injected)
        await waitForPodRunning(kc, opts.namespace, podName, podTimeoutMs)

        const windowStart = new Date().toISOString()
        const probeStartMs = Date.now()
        const execResult = await execCapturing(kc, opts.namespace, podName, container, probeCommand, execTimeoutMs)
        const responseTimeMs = Date.now() - probeStartMs

        const { reachable, httpStatus, errorType } = interpretProbeResult(
          protocol as Protocol, execResult.result, execResult.exitCode, execResult.stdout,
        )
        observedOutcome = reachable ? 'reachable' : 'unreachable'

        rawResponse = JSON.stringify({
          protocol,
          reachable,
          ...(httpStatus !== undefined ? { httpStatus } : {}),
          responseTimeMs,
          ...(errorType ? { errorType } : {}),
          stdout: execResult.stdout,
          stderr: execResult.stderr,
        })

        if (opts.alertSource !== 'none') {
          const alert = await alertSource.pollForAlert(opts.namespace, 'chaosclaw-test-', windowStart, observationWindowMs)
          if (alert) {
            alertJson = JSON.stringify(alert)
            rawResponse = JSON.stringify({ protocol, reachable, httpStatus, responseTimeMs, errorType, alert })
          }
        }
      } catch (err: unknown) {
        observedOutcome = 'api_error'
        rawResponse = err instanceof Error ? err.message : String(err)
        likelyIssue = 'Kubernetes API error — check cluster connectivity and RBAC'
      }

      const status = observedOutcome === 'api_error' ? 'Error' as const
        : observedOutcome === opts.expect ? 'Pass' as const
        : 'Fail' as const

      if (status === 'Fail') likelyIssue = diagnoseNetwork(opts.expect as NetworkExpect, observedOutcome)

      const createdResources = podName
        ? [{ kind: 'Pod' as const, name: podName, namespace: opts.namespace }]
        : []
      const shouldCleanup = opts.cleanup === 'always' || (opts.cleanup === 'on-success' && status === 'Pass')
      const cleanupResult = shouldCleanup
        ? await cleanup.cleanup(createdResources)
        : { status: 'skipped' as const, remainingResources: [] }

      const result = {
        scenarioId,
        version: 1,
        status,
        expectedOutcome: opts.expect,
        observedOutcome,
        cleanupStatus: cleanupResult.status,
        startedAt,
        endedAt: new Date().toISOString(),
        rawResponse,
        likelyIssue,
      }

      builder.addResult(result)
      const evidence = builder.build(new Date().toISOString())

      if (opts.format === 'json') {
        console.log(JSON.stringify(evidence, null, 2))
        process.exit(status === 'Pass' ? 0 : 1)
      }

      indent(`${outcomeLabel(result.status)} ${scenarioId}`)

      section('Summary')
      indent(`Status:   ${status}`)
      indent(`Expected: ${opts.expect}`)
      indent(`Observed: ${observedOutcome}`)
      if (likelyIssue) indent(`Issue:    ${likelyIssue}`)

      if (alertJson) {
        const alert = JSON.parse(alertJson) as { source: string; ruleName: string; podName: string; triggeredAt: string; action?: string }
        section('Alert Fired')
        indent(`Source:    ${alert.source}`)
        indent(`Rule:      ${alert.ruleName}`)
        indent(`Pod:       ${alert.podName}`)
        indent(`Action:    ${alert.action ?? 'detected'}`)
        indent(`Triggered: ${alert.triggeredAt}`)
      }

      if (cleanupResult.remainingResources.length > 0) {
        blank()
        console.log(chalk.yellow('[WARN] Cleanup incomplete — delete these resources manually:'))
        for (const r of cleanupResult.remainingResources) {
          indent(`kubectl delete ${r.kind.toLowerCase()} ${r.name} -n ${r.namespace}`)
        }
      }

      if (opts.output) {
        await builder.writeToFile(opts.output, evidence)
        section('Artifacts')
        indent(`JSON report written to: ${opts.output}`)
      }

      blank()
      process.exit(status === 'Pass' ? 0 : 1)
    })
}

/** Infer protocol from the target URL if --protocol is not specified */
function resolveProtocol(target: string, explicit?: string): string {
  if (explicit) return explicit
  if (target.startsWith('https://')) return 'https'
  if (target.startsWith('http://')) return 'http'
  return 'tcp'
}

/**
 * Build the probe command for exec inside the pod.
 * curl: outputs http_code|time_total to stdout; non-zero exit = unreachable.
 * nc:   exit 0 = reachable, non-zero = unreachable.
 */
function buildProbeCommand(target: string, protocol: Protocol, connectTimeoutS: number): string[] {
  switch (protocol) {
    case 'http':
    case 'https':
      return [
        'curl', '-s', '-o', '/dev/null',
        '-w', '%{http_code}|%{time_total}',
        '--connect-timeout', String(connectTimeoutS),
        '--max-time', String(connectTimeoutS + 2),
        target,
      ]
    case 'tcp': {
      const lastColon = target.lastIndexOf(':')
      const host = target.slice(0, lastColon)
      const port = target.slice(lastColon + 1)
      return ['nc', '-zw', String(connectTimeoutS), host, port]
    }
  }
}

interface ProbeInterpretation {
  reachable: boolean
  httpStatus?: number
  errorType?: string
}

function interpretProbeResult(
  protocol: Protocol,
  result: string,
  exitCode: number | undefined,
  stdout: string,
): ProbeInterpretation {
  if (protocol === 'http' || protocol === 'https') {
    // curl exits 0 if it got a response (even 4xx/5xx)
    if (result === 'succeeded') {
      const parts = stdout.trim().split('|')
      const httpStatus = parts[0] ? parseInt(parts[0], 10) : undefined
      return { reachable: true, httpStatus }
    }
    // Distinguish common curl exit codes
    const errorType = exitCode === 6 ? 'dns_failure'
      : exitCode === 7 ? 'refused'
      : exitCode === 28 ? 'timeout'
      : 'unknown'
    return { reachable: false, errorType }
  }

  // TCP (nc): exit 0 = connected
  if (result === 'succeeded') return { reachable: true }
  return { reachable: false, errorType: result === 'timeout' ? 'timeout' : 'refused_or_unreachable' }
}

function diagnoseNetwork(expected: NetworkExpect, observed: string): string {
  if (expected === 'unreachable' && observed === 'reachable') {
    return 'Target is reachable — network policy or firewall rule is missing or not enforced'
  }
  if (expected === 'reachable' && observed === 'unreachable') {
    return 'Target is unreachable — check network policy, firewall rules, and DNS resolution from the pod'
  }
  return 'Unexpected outcome — inspect the raw response for details'
}
