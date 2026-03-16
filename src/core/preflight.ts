import * as k8s from '@kubernetes/client-node'

export type PreflightCheckStatus = 'pass' | 'fail' | 'warn'

export interface PreflightCheck {
  name: string
  status: PreflightCheckStatus
  detail?: string
}

export interface PreflightResult {
  clusterContext: string
  namespace: string
  checks: PreflightCheck[]
  passed: boolean
  hasWarnings: boolean
}

export interface PreflightOptions {
  context?: string
  namespace: string
}

export class PreflightEngine {
  private readonly kc: k8s.KubeConfig

  constructor() {
    this.kc = new k8s.KubeConfig()
    this.kc.loadFromDefault()
  }

  async run(options: PreflightOptions): Promise<PreflightResult> {
    if (options.context) {
      this.kc.setCurrentContext(options.context)
    }
    const context = this.kc.getCurrentContext()

    const checks: PreflightCheck[] = []

    checks.push(await this.checkClusterReachable())
    checks.push(await this.checkAuthentication())
    checks.push(await this.checkNamespaceCreation(options.namespace))
    checks.push(await this.checkPodPermissions(options.namespace))
    checks.push(await this.checkCleanupPermissions(options.namespace))

    const passed = checks.every(c => c.status !== 'fail')
    const hasWarnings = checks.some(c => c.status === 'warn')

    return { clusterContext: context, namespace: options.namespace, checks, passed, hasWarnings }
  }

  private async checkClusterReachable(): Promise<PreflightCheck> {
    try {
      const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
      await coreApi.listNamespace()
      return { name: 'Cluster reachable', status: 'pass' }
    } catch {
      return { name: 'Cluster reachable', status: 'fail', detail: 'Could not reach the Kubernetes API server' }
    }
  }

  private async checkAuthentication(): Promise<PreflightCheck> {
    try {
      const authApi = this.kc.makeApiClient(k8s.AuthenticationV1Api)
      await authApi.createTokenReview({
        apiVersion: 'authentication.k8s.io/v1',
        kind: 'TokenReview',
        spec: { token: 'probe' },
      })
      return { name: 'Authentication valid', status: 'pass' }
    } catch (err: unknown) {
      const status = (err as { response?: { statusCode?: number } }).response?.statusCode
      if (status === 401) {
        return { name: 'Authentication valid', status: 'fail', detail: 'Credentials are invalid or expired' }
      }
      return { name: 'Authentication valid', status: 'pass' }
    }
  }

  private async checkNamespaceCreation(namespace: string): Promise<PreflightCheck> {
    try {
      const authzApi = this.kc.makeApiClient(k8s.AuthorizationV1Api)
      const { body } = await authzApi.createSelfSubjectAccessReview({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            verb: 'create',
            resource: 'namespaces',
            namespace,
          },
        },
      })
      const allowed = body.status?.allowed === true
      return {
        name: 'Namespace creation allowed',
        status: allowed ? 'pass' : 'fail',
        detail: allowed ? undefined : `Cannot create namespace "${namespace}" — use --namespace to specify an existing one`,
      }
    } catch {
      return { name: 'Namespace creation allowed', status: 'fail', detail: 'Could not check namespace permissions' }
    }
  }

  private async checkPodPermissions(namespace: string): Promise<PreflightCheck> {
    try {
      const authzApi = this.kc.makeApiClient(k8s.AuthorizationV1Api)
      const { body } = await authzApi.createSelfSubjectAccessReview({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            verb: 'create',
            resource: 'pods',
            namespace,
          },
        },
      })
      const allowed = body.status?.allowed === true
      return {
        name: 'Pod create/delete permissions available',
        status: allowed ? 'pass' : 'fail',
        detail: allowed ? undefined : 'Cannot create pods in the test namespace',
      }
    } catch {
      return { name: 'Pod create/delete permissions available', status: 'fail', detail: 'Could not check pod permissions' }
    }
  }

  private async checkCleanupPermissions(namespace: string): Promise<PreflightCheck> {
    try {
      const authzApi = this.kc.makeApiClient(k8s.AuthorizationV1Api)
      const { body } = await authzApi.createSelfSubjectAccessReview({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            verb: 'delete',
            resource: 'pods',
            namespace,
          },
        },
      })
      const allowed = body.status?.allowed === true
      return {
        name: 'Cleanup permissions available',
        status: allowed ? 'pass' : 'warn',
        detail: allowed ? undefined : 'Cannot delete pods — cleanup may fail after runs',
      }
    } catch {
      return { name: 'Cleanup permissions available', status: 'warn', detail: 'Could not verify cleanup permissions' }
    }
  }
}
