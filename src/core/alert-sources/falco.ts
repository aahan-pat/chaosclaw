// Alert source adapter for Falco.
// Reads JSON-formatted alerts from Falco pod logs and correlates them to the
// test pod by namespace and pod name prefix.
//
// Requirement: Falco must be configured with JSON output enabled.
// Set json_output: true in falco.yaml or pass --json-output to the Falco process.
// The Helm chart supports this via `falco.jsonOutput: true`.
import { LogBasedAlertSource } from './log-based.js'
import type { RuntimeAlert } from '../runtime-executor.js'

interface FalcoJsonEvent {
  rule?: string
  time?: string
  priority?: string
  output_fields?: Record<string, string>
}

export class FalcoAlertSource extends LogBasedAlertSource {
  readonly name = 'falco'

  protected readonly labelSelectors = [
    'app.kubernetes.io/name=falco',  // current Helm chart
    'app=falco',                      // legacy / manual deployments
  ]

  protected readonly containerName = 'falco'

  protected parseLine(line: string, namespace: string, podNamePrefix: string): RuntimeAlert | null {
    if (!line.startsWith('{')) return null
    try {
      const ev = JSON.parse(line) as FalcoJsonEvent
      if (!ev.rule || !ev.time) return null

      const fields = ev.output_fields ?? {}
      const alertNs = fields['k8s.ns.name'] ?? ''
      const alertPod = fields['k8s.pod.name'] ?? ''
      if (alertNs !== namespace || !alertPod.startsWith(podNamePrefix)) return null

      return {
        source: 'falco',
        ruleName: ev.rule,
        namespace: alertNs,
        podName: alertPod,
        triggeredAt: ev.time,
        action: 'detected',  // Falco is detection-only; it never blocks syscalls
        raw: line,
      }
    } catch {
      return null
    }
  }
}
