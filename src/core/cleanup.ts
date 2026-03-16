import * as k8s from '@kubernetes/client-node'
import type { CleanupStatus } from '../types/evidence.js'

export interface CleanupTarget {
  kind: 'Pod'
  name: string
  namespace: string
}

export interface CleanupResult {
  status: CleanupStatus
  detail?: string
  remainingResources: CleanupTarget[]
}

export class CleanupManager {
  private readonly kc: k8s.KubeConfig

  constructor(kc: k8s.KubeConfig) {
    this.kc = kc
  }

  async cleanup(targets: CleanupTarget[]): Promise<CleanupResult> {
    if (targets.length === 0) {
      return { status: 'skipped', remainingResources: [] }
    }

    const remaining: CleanupTarget[] = []

    for (const target of targets) {
      const ok = await this.deleteResource(target)
      if (!ok) remaining.push(target)
    }

    if (remaining.length === 0) {
      return { status: 'success', remainingResources: [] }
    }

    if (remaining.length < targets.length) {
      return {
        status: 'partial',
        detail: `${remaining.length} resource(s) could not be deleted`,
        remainingResources: remaining,
      }
    }

    return {
      status: 'failed',
      detail: 'No resources could be deleted',
      remainingResources: remaining,
    }
  }

  private async deleteResource(target: CleanupTarget): Promise<boolean> {
    try {
      if (target.kind === 'Pod') {
        const coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
        await coreApi.deleteNamespacedPod(target.name, target.namespace)
      }
      return true
    } catch {
      return false
    }
  }
}
