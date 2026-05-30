// Creates and configures the chaosclaw test namespace used by all recon and pentest operations.
// All operations are idempotent — safe to run multiple times on an existing namespace.
import * as k8s from '@kubernetes/client-node'
import type { ReconOptions } from '../../types/recon.js'

export interface InitStep {
  name: string
  status: 'ok' | 'already-existed' | 'failed'
  detail?: string
}

export interface InitResult {
  clusterContext: string
  namespace: string
  steps: InitStep[]
  /** True when the namespace already existed before this run */
  alreadyExisted: boolean
}

export class ReconInitEngine {
  constructor(private readonly kc: k8s.KubeConfig) {}

  async run(options: ReconOptions): Promise<InitResult> {
    const context = this.kc.getCurrentContext()
    const ns = options.namespace
    const steps: InitStep[] = []

    // Create the namespace first; all subsequent steps depend on it existing.
    const nsStep = await this.ensureNamespace(ns)
    steps.push(nsStep)
    const alreadyExisted = nsStep.status === 'already-existed'

    // Stop early if namespace creation failed — subsequent steps will also fail
    if (nsStep.status === 'failed') {
      return { clusterContext: context, namespace: ns, steps, alreadyExisted: false }
    }

    // Apply ResourceQuota, ServiceAccount, Role, and RoleBinding in dependency order.
    steps.push(await this.ensureResourceQuota(ns))
    steps.push(await this.ensureServiceAccount(ns))
    steps.push(await this.ensureRole(ns))
    steps.push(await this.ensureRoleBinding(ns))

    return { clusterContext: context, namespace: ns, steps, alreadyExisted }
  }

  private async ensureNamespace(namespace: string): Promise<InitStep> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    try {
      await coreApi.createNamespace({
        body: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace } },
      })
      return { name: `Namespace ${namespace} created`, status: 'ok' }
    } catch (err: unknown) {
      // 409 means the namespace already exists — treat it as already-existed, not a failure.
      if (this.statusCode(err) === 409) {
        return { name: `Namespace ${namespace} already exists`, status: 'already-existed' }
      }
      return { name: `Create namespace ${namespace}`, status: 'failed', detail: this.message(err) }
    }
  }

  private async ensureResourceQuota(namespace: string): Promise<InitStep> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    // Define conservative limits so test pods cannot consume unbounded cluster resources.
    const quota: k8s.V1ResourceQuota = {
      apiVersion: 'v1',
      kind: 'ResourceQuota',
      metadata: { name: 'chaosclaw-quota', namespace },
      spec: {
        hard: {
          pods: '10',
          'requests.cpu': '2',
          'requests.memory': '2Gi',
          'limits.cpu': '4',
          'limits.memory': '4Gi',
        },
      },
    }
    try {
      await coreApi.createNamespacedResourceQuota({ namespace, body: quota })
      return { name: 'ResourceQuota applied (pods: 10, cpu: 2, memory: 2Gi)', status: 'ok' }
    } catch (err: unknown) {
      if (this.statusCode(err) === 409) {
        // Quota exists — patch it to ensure limits are current
        try {
          await coreApi.replaceNamespacedResourceQuota({ name: 'chaosclaw-quota', namespace, body: quota })
        } catch {
          // Patch failure is non-fatal — quota already exists and bounds are in place
        }
        return { name: 'ResourceQuota verified (idempotent)', status: 'already-existed' }
      }
      return { name: 'ResourceQuota', status: 'failed', detail: this.message(err) }
    }
  }

  private async ensureServiceAccount(namespace: string): Promise<InitStep> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    try {
      // Create a dedicated service account so test pods run under a known, scoped identity.
      await coreApi.createNamespacedServiceAccount({
        namespace,
        body: {
          apiVersion: 'v1',
          kind: 'ServiceAccount',
          metadata: { name: 'chaosclaw-runner', namespace },
        },
      })
      return { name: 'ServiceAccount chaosclaw-runner created', status: 'ok' }
    } catch (err: unknown) {
      if (this.statusCode(err) === 409) {
        return { name: 'ServiceAccount chaosclaw-runner already present', status: 'already-existed' }
      }
      return { name: 'ServiceAccount chaosclaw-runner', status: 'failed', detail: this.message(err) }
    }
  }

  private async ensureRole(namespace: string): Promise<InitStep> {
    const rbacApi = this.kc.makeApiClient(k8s.RbacAuthorizationV1Api)
    // Grant only the minimal permissions needed to create, inspect, and delete test pods.
    const role: k8s.V1Role = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: 'chaosclaw-runner', namespace },
      rules: [
        { apiGroups: [''], resources: ['pods'], verbs: ['create', 'get', 'list', 'delete'] },
        { apiGroups: [''], resources: ['resourcequotas'], verbs: ['get'] },
      ],
    }
    try {
      await rbacApi.createNamespacedRole({ namespace, body: role })
      return { name: 'Role chaosclaw-runner created (scoped to namespace)', status: 'ok' }
    } catch (err: unknown) {
      if (this.statusCode(err) === 409) {
        return { name: 'Role chaosclaw-runner already present', status: 'already-existed' }
      }
      return { name: 'Role chaosclaw-runner', status: 'failed', detail: this.message(err) }
    }
  }

  private async ensureRoleBinding(namespace: string): Promise<InitStep> {
    const rbacApi = this.kc.makeApiClient(k8s.RbacAuthorizationV1Api)
    // Bind the runner ServiceAccount to the Role, scoping it to this namespace only.
    const binding: k8s.V1RoleBinding = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: 'chaosclaw-runner', namespace },
      subjects: [{ kind: 'ServiceAccount', name: 'chaosclaw-runner', namespace }],
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'chaosclaw-runner' },
    }
    try {
      await rbacApi.createNamespacedRoleBinding({ namespace, body: binding })
      return { name: 'RoleBinding applied (SA scoped to namespace only)', status: 'ok' }
    } catch (err: unknown) {
      if (this.statusCode(err) === 409) {
        return { name: 'RoleBinding already present', status: 'already-existed' }
      }
      return { name: 'RoleBinding', status: 'failed', detail: this.message(err) }
    }
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
