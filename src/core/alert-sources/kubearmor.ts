// Alert source adapter for KubeArmor.
// Reads policy-match events from KubeArmor pod logs and correlates them to the
// test pod by namespace and pod name prefix.
//
// KubeArmor logs MatchedPolicy events to stdout when a KubeArmorPolicy rule
// triggers. The Action field distinguishes detection (Audit) from enforcement (Block).
//
// Requirement: KubeArmorPolicies must be installed targeting the test namespace.
// Without a matching policy, KubeArmor will not emit MatchedPolicy events.
import { LogBasedAlertSource } from './log-based.js'
import type { RuntimeAlert } from '../runtime-executor.js'

interface KubeArmorLog {
  NamespaceName?: string
  PodName?: string
  PolicyName?: string
  Operation?: string
  Action?: string
  Type?: string
  UpdatedTime?: string
}

const MATCHED_POLICY_TYPES = new Set(['MatchedPolicy', 'MatchedHostPolicy'])

export class KubeArmorAlertSource extends LogBasedAlertSource {
  readonly name = 'kubearmor'

  protected readonly labelSelectors = [
    'kubearmor-app=kubearmor',  // official Helm chart
    'app=kubearmor',
  ]

  protected readonly containerName = 'kubearmor'

  protected parseLine(line: string, namespace: string, podNamePrefix: string): RuntimeAlert | null {
    if (!line.startsWith('{')) return null
    try {
      const ev = JSON.parse(line) as KubeArmorLog
      if (!ev.NamespaceName || !ev.PodName) return null
      if (ev.NamespaceName !== namespace || !ev.PodName.startsWith(podNamePrefix)) return null

      // Only surface policy-match events — raw telemetry events don't represent detections
      if (ev.Type && !MATCHED_POLICY_TYPES.has(ev.Type)) return null

      return {
        source: 'kubearmor',
        ruleName: ev.PolicyName ?? ev.Operation ?? 'policy_match',
        namespace: ev.NamespaceName,
        podName: ev.PodName,
        triggeredAt: ev.UpdatedTime ?? new Date().toISOString(),
        action: ev.Action === 'Block' ? 'blocked' : 'detected',
        raw: line,
      }
    } catch {
      return null
    }
  }
}
