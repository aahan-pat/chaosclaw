// Implements "chaosclaw verify identity" — the RBAC capability primitive.
// Tests what a specific service account is actually authorized to do by issuing
// a SubjectAccessReview against the Kubernetes API.
// No pod is created; this is a pure API call. Runtime detection does not apply.
import * as k8s from '@kubernetes/client-node'
import type { Command } from 'commander'
import { EvidenceBuilder } from '../../core/evidence-builder.js'
import { header, field, section, indent, outcomeLabel, blank } from '../output.js'

const DEFAULT_NAMESPACE = 'chaosclaw-tests'

const VALID_EXPECTS = ['allowed', 'denied'] as const
type IdentityExpect = (typeof VALID_EXPECTS)[number]

export function registerIdentityCommand(verify: Command): void {
  verify
    .command('identity')
    .description('Test what a service account is authorized to do via SubjectAccessReview')
    .requiredOption('--as <sa-name>', 'Service account name to test')
    .requiredOption('--can <verb>', 'Verb to test: get, list, create, delete, *, exec, etc.')
    .requiredOption('--resource <resource>', 'Resource to test: secrets, pods, pods/exec, clusterrolebindings, etc.')
    .option('--resource-namespace <ns>', 'Namespace to scope the permission check (omit for cluster-scoped check)')
    .option('--group <api-group>', 'API group of the resource (default: "" for core resources; use rbac.authorization.k8s.io for RBAC resources)')
    .requiredOption('--expect <outcome>', 'Expected outcome: allowed, denied')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Namespace the service account lives in', DEFAULT_NAMESPACE)
    .option('--output <path>', 'Write JSON evidence artifact to file')
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .action(async (opts: {
      as: string
      can: string
      resource: string
      resourceNamespace?: string
      group?: string
      expect: string
      context?: string
      namespace: string
      output?: string
      format: string
    }) => {
      if (!VALID_EXPECTS.includes(opts.expect as IdentityExpect)) {
        console.error(`\nError\n  --expect must be one of: ${VALID_EXPECTS.join(', ')}. Got: "${opts.expect}"`)
        process.exit(4)
      }

      const kc = new k8s.KubeConfig()
      kc.loadFromDefault()
      if (opts.context) kc.setCurrentContext(opts.context)
      const clusterContext = opts.context ?? kc.getCurrentContext()

      const [resource, subresource] = opts.resource.includes('/')
        ? opts.resource.split('/', 2) as [string, string | undefined]
        : [opts.resource, undefined]

      const saUser = `system:serviceaccount:${opts.namespace}:${opts.as}`
      const scenarioId = `identity:${opts.as}/${opts.can}/${opts.resource}`
      const startedAt = new Date().toISOString()
      const builder = new EvidenceBuilder({ clusterContext, startedAt })

      if (opts.format !== 'json') {
        header('ChaosClaw Identity')
        field('Cluster Context', clusterContext)
        field('Service Account', saUser)
        field('Verb', opts.can)
        field('Resource', opts.resource)
        if (opts.resourceNamespace) field('Resource Namespace', opts.resourceNamespace)
        if (opts.group) field('API Group', opts.group)
        field('Expect', opts.expect)
        section('Running')
      }

      let observedOutcome: string
      let likelyIssue: string | undefined
      let rawResponse: string

      try {
        const authApi = kc.makeApiClient(k8s.AuthorizationV1Api)
        const review = await authApi.createSubjectAccessReview({
          body: {
            apiVersion: 'authorization.k8s.io/v1',
            kind: 'SubjectAccessReview',
            spec: {
              user: saUser,
              resourceAttributes: {
                namespace: opts.resourceNamespace,
                verb: opts.can,
                resource,
                subresource,
                group: opts.group ?? '',
              },
            },
          },
        })

        const allowed = review.status?.allowed === true
        observedOutcome = allowed ? 'allowed' : 'denied'
        rawResponse = JSON.stringify({
          serviceAccount: saUser,
          verb: opts.can,
          resource: opts.resource,
          resourceNamespace: opts.resourceNamespace,
          allowed,
          evaluationError: review.status?.evaluationError,
        })
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode ?? (err as { code?: number }).code
        if (statusCode === 403) {
          console.error('\nError\n  Insufficient permissions to create SubjectAccessReview')
          console.error('  This requires: create subjectaccessreviews (authorization.k8s.io)')
          process.exit(2)
        }
        observedOutcome = 'api_error'
        rawResponse = err instanceof Error ? err.message : String(err)
        likelyIssue = 'Kubernetes API error — check cluster connectivity and RBAC'
      }

      const status = observedOutcome === 'api_error' ? 'Error' as const
        : observedOutcome === opts.expect ? 'Pass' as const
        : 'Fail' as const

      if (status === 'Fail') likelyIssue = diagnoseIdentity(opts.expect as IdentityExpect, observedOutcome, opts.as, opts.can, opts.resource)

      const result = {
        scenarioId,
        version: 1,
        status,
        expectedOutcome: opts.expect,
        observedOutcome,
        cleanupStatus: 'skipped' as const,
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
      indent(`Status:         ${status}`)
      indent(`Service Account: ${saUser}`)
      indent(`Permission:     ${opts.can} ${opts.resource}${opts.resourceNamespace ? ` in ${opts.resourceNamespace}` : ' (cluster-scoped)'}`)
      indent(`Expected:       ${opts.expect}`)
      indent(`Observed:       ${observedOutcome}`)
      if (likelyIssue) indent(`Issue:          ${likelyIssue}`)

      if (opts.output) {
        await builder.writeToFile(opts.output, evidence)
        section('Artifacts')
        indent(`JSON report written to: ${opts.output}`)
      }

      blank()
      process.exit(status === 'Pass' ? 0 : 1)
    })
}

function diagnoseIdentity(expected: IdentityExpect, observed: string, sa: string, verb: string, resource: string): string {
  if (expected === 'denied' && observed === 'allowed') {
    return `${sa} can ${verb} ${resource} — RBAC grants more permission than expected`
  }
  if (expected === 'allowed' && observed === 'denied') {
    return `${sa} cannot ${verb} ${resource} — check RoleBinding or ClusterRoleBinding`
  }
  return 'Unexpected outcome — inspect the raw response for details'
}
