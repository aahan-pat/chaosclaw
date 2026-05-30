import * as k8s from '@kubernetes/client-node'
import { ScenarioExecutor } from '../../../core/executor.js'
import { ValidationEngine } from '../../../core/validator.js'
import { RuntimeScenarioExecutor } from '../../../core/runtime-executor.js'
import { RuntimeValidationEngine } from '../../../core/runtime-validator.js'
import { buildAlertSource } from '../../../core/alert-sources/index.js'
import { CleanupManager } from '../../../core/cleanup.js'
import { EvidenceBuilder } from '../../../core/evidence-builder.js'

export interface RunContext {
  kc: k8s.KubeConfig
  clusterContext: string
  executor: ScenarioExecutor
  validator: ValidationEngine
  runtimeExecutor: RuntimeScenarioExecutor | null
  runtimeValidator: RuntimeValidationEngine
  cleanup: CleanupManager
  builder: EvidenceBuilder
}

export async function buildRunContext(opts: {
  context?: string
  namespace: string
  alertSource: string
  pack?: string
  scenario?: string
  hasRuntime: boolean
}): Promise<RunContext> {
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()
  if (opts.context) kc.setCurrentContext(opts.context)
  const clusterContext = opts.context ?? kc.getCurrentContext()

  await ensureNamespace(kc, opts.namespace)

  const executor = new ScenarioExecutor(kc)
  const validator = new ValidationEngine()
  const runtimeExecutor = opts.hasRuntime
    ? new RuntimeScenarioExecutor(kc, buildAlertSource(opts.alertSource, kc))
    : null
  const runtimeValidator = new RuntimeValidationEngine()
  const cleanup = new CleanupManager(kc)
  const builder = new EvidenceBuilder({
    clusterContext,
    packId: opts.pack,
    packVersion: opts.pack ? '1' : undefined,
    scenarioId: opts.scenario,
    startedAt: new Date().toISOString(),
  })

  return { kc, clusterContext, executor, validator, runtimeExecutor, runtimeValidator, cleanup, builder }
}

async function ensureNamespace(kc: k8s.KubeConfig, namespace: string): Promise<void> {
  const coreApi = kc.makeApiClient(k8s.CoreV1Api)
  try {
    await coreApi.createNamespace({ body: { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace } } })
  } catch (err: unknown) {
    const code = (err as { code?: number; statusCode?: number }).code ?? (err as { statusCode?: number }).statusCode
    if (code !== 409) throw err
  }
}
