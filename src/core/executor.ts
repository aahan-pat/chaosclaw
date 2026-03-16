import * as k8s from '@kubernetes/client-node'
import type { ScenarioDefinition } from '../types/scenario.js'

export type ObservedOutcome = 'admission_rejected' | 'admission_allowed' | 'timeout' | 'api_error'

export interface ExecutionResult {
  observedOutcome: ObservedOutcome
  rawResponse: string
  manifestSnapshot: string
  startedAt: string
  endedAt: string
  createdResourceName?: string
}

export interface ExecutorOptions {
  namespace: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export class ScenarioExecutor {
  private readonly kc: k8s.KubeConfig

  constructor(kc: k8s.KubeConfig) {
    this.kc = kc
  }

  async execute(scenario: ScenarioDefinition, options: ExecutorOptions): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString()
    const manifest = this.injectNamespace(scenario.manifest, options.namespace)
    const manifestSnapshot = JSON.stringify(manifest)

    try {
      const result = await this.applyWithTimeout(manifest, options.namespace, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      return { ...result, manifestSnapshot, startedAt, endedAt: new Date().toISOString() }
    } catch (err: unknown) {
      const endedAt = new Date().toISOString()
      if (this.isAdmissionRejection(err)) {
        return { observedOutcome: 'admission_rejected', rawResponse: this.formatError(err), manifestSnapshot, startedAt, endedAt }
      }
      return { observedOutcome: 'api_error', rawResponse: this.formatError(err), manifestSnapshot, startedAt, endedAt }
    }
  }

  private async applyWithTimeout(
    manifest: Record<string, unknown>,
    namespace: string,
    timeoutMs: number,
  ): Promise<Pick<ExecutionResult, 'observedOutcome' | 'rawResponse' | 'createdResourceName'>> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs),
    )
    return Promise.race([this.applyManifest(manifest, namespace), timeoutPromise])
  }

  private async applyManifest(
    manifest: Record<string, unknown>,
    namespace: string,
  ): Promise<Pick<ExecutionResult, 'observedOutcome' | 'rawResponse' | 'createdResourceName'>> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    const kind = manifest['kind'] as string | undefined

    if (kind === 'Pod') {
      const pod = manifest as k8s.V1Pod
      const { body } = await coreApi.createNamespacedPod(namespace, pod)
      return {
        observedOutcome: 'admission_allowed',
        rawResponse: JSON.stringify({ status: 'created', name: body.metadata?.name }),
        createdResourceName: body.metadata?.name,
      }
    }

    throw new Error(`Unsupported manifest kind: ${kind ?? 'unknown'}`)
  }

  private injectNamespace(manifest: Record<string, unknown>, namespace: string): Record<string, unknown> {
    const meta = manifest['metadata'] as Record<string, unknown> | undefined ?? {}
    return {
      ...manifest,
      metadata: { ...meta, namespace, generateName: 'chaosclaw-test-', name: undefined },
    }
  }

  private isAdmissionRejection(err: unknown): boolean {
    const status = (err as { response?: { statusCode?: number } }).response?.statusCode
    return status === 403 || status === 400
  }

  private formatError(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
  }
}
