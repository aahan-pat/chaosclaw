// Surveys admission webhooks installed on the cluster, identifying failure-open configurations
// that could allow policy bypasses if the webhook becomes unreachable.
import * as k8s from '@kubernetes/client-node'
import type { ReconFinding, ReconOptions, ReconToolResult } from '../../types/recon.js'

export interface WebhookInfo {
  name: string
  type: 'validating' | 'mutating'
  ruleCount: number
  failurePolicy: string
  scope: string
}

export class WebhookReconEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(_options: ReconOptions): Promise<ReconToolResult> {
    const admissionApi = this.kc.makeApiClient(k8s.AdmissionregistrationV1Api)

    try {
      // Fetch both webhook types in parallel to reduce total latency.
      const [validatingRes, mutatingRes] = await Promise.all([
        admissionApi.listValidatingWebhookConfiguration(),
        admissionApi.listMutatingWebhookConfiguration(),
      ])

      const webhooks: WebhookInfo[] = []

      // Flatten each WebhookConfiguration (which can contain multiple webhooks) into individual entries.
      for (const config of validatingRes.items) {
        for (const wh of config.webhooks ?? []) {
          webhooks.push({
            name: wh.name,
            type: 'validating',
            ruleCount: wh.rules?.length ?? 0,
            failurePolicy: wh.failurePolicy ?? 'Fail',
            scope: this.formatScope(wh.namespaceSelector),
          })
        }
      }

      for (const config of mutatingRes.items) {
        for (const wh of config.webhooks ?? []) {
          webhooks.push({
            name: wh.name,
            type: 'mutating',
            ruleCount: wh.rules?.length ?? 0,
            failurePolicy: wh.failurePolicy ?? 'Fail',
            scope: this.formatScope(wh.namespaceSelector),
          })
        }
      }

      return {
        tool: 'webhooks',
        status: 'ok',
        findings: this.analyze(webhooks),
        data: { webhooks },
      }
    } catch (err: unknown) {
      // 403 means missing RBAC — downgrade to 'skip' so the overall survey can continue.
      if (this.statusCode(err) === 403) {
        return {
          tool: 'webhooks',
          status: 'skip',
          findings: [{
            severity: 'SKIP',
            title: 'Webhook recon skipped',
            detail: 'Cannot list validatingwebhookconfigurations or mutatingwebhookconfigurations',
            missingPermission: 'list validatingwebhookconfigurations, mutatingwebhookconfigurations',
            coverageImpact: 'Admission controller coverage and failure-open risk cannot be assessed',
          }],
          data: {},
        }
      }
      return { tool: 'webhooks', status: 'error', findings: [], data: { error: this.message(err) } }
    }
  }

  // Determine webhook scope by checking whether a namespace selector is present.
  private formatScope(selector?: k8s.V1LabelSelector | null): string {
    if (!selector?.matchExpressions?.length && !selector?.matchLabels) return 'cluster-wide'
    return 'namespace-scoped'
  }

  private analyze(webhooks: WebhookInfo[]): ReconFinding[] {
    const findings: ReconFinding[] = []

    // No webhooks at all is a HIGH finding — enforcement relies entirely on PSA.
    if (webhooks.length === 0) {
      findings.push({
        severity: 'HIGH',
        title: 'No admission webhooks detected',
        detail: 'The cluster has no Kyverno, OPA/Gatekeeper, or custom webhook-based admission controls. Enforcement relies entirely on built-in PSA and ResourceQuota.',
      })
      return findings
    }

    // Identify webhooks configured with failurePolicy: Ignore, which bypass admission on errors.
    const failOpen = webhooks.filter(w => w.failurePolicy === 'Ignore')
    for (const wh of failOpen) {
      findings.push({
        severity: 'HIGH',
        title: `${wh.name} — failurePolicy: Ignore`,
        detail: `If this webhook is unreachable, admission is bypassed for its scope (${wh.scope})`,
      })
    }

    // All webhooks use Fail — this is the secure posture, report as INFO.
    if (failOpen.length === 0) {
      findings.push({
        severity: 'INFO',
        title: 'All admission webhooks use failurePolicy: Fail',
        detail: 'No webhook fails open — admission is denied if a webhook is unreachable',
      })
    }

    return findings
  }

  private statusCode(err: unknown): number | undefined {
    const e = err as Record<string, unknown>
    if (typeof e?.['code'] === 'number') return e['code']
    return (e?.['response'] as Record<string, unknown> | undefined)?.['statusCode'] as number | undefined
  }

  private message(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}
