import { ScenarioRegistry } from '../../../core/registry.js'
import { pack as preventivePack, scenarios as preventiveScenarios } from '../../../scenarios/preventive-baseline/index.js'
import { pack as runtimePack, scenarios as runtimeScenarios } from '../../../scenarios/runtime-baseline/index.js'
import type { ScenarioDefinition } from '../../../types/scenario.js'
import type { RuntimeScenarioDefinition } from '../../../types/runtime-scenario.js'

export type AnyScenario = ScenarioDefinition | RuntimeScenarioDefinition

export function isRuntimeScenario(s: AnyScenario): s is RuntimeScenarioDefinition {
  return 'execStep' in s
}

function buildRegistry(): { preventive: ScenarioRegistry; runtime: Map<string, RuntimeScenarioDefinition>; runtimePacks: Map<string, string[]> } {
  const preventive = new ScenarioRegistry()
  preventive.registerPack(preventivePack)
  for (const s of preventiveScenarios) preventive.register(s)

  const runtime = new Map<string, RuntimeScenarioDefinition>()
  for (const s of runtimeScenarios) runtime.set(s.id, s)

  const runtimePacks = new Map<string, string[]>()
  runtimePacks.set(runtimePack.id, runtimePack.scenarioIds)

  return { preventive, runtime, runtimePacks }
}

export function resolveScenarios(opts: { pack?: string; scenario?: string }): AnyScenario[] {
  const { preventive, runtime, runtimePacks } = buildRegistry()

  if (opts.pack) {
    const preventiveResults = preventive.getScenariosForPack(opts.pack)
    const runtimeIds = runtimePacks.get(opts.pack) ?? []
    const runtimeResults = runtimeIds
      .map(id => runtime.get(id))
      .filter((s): s is RuntimeScenarioDefinition => s !== undefined)
    return [...preventiveResults, ...runtimeResults]
  }

  if (opts.scenario) {
    const p = preventive.getScenario(opts.scenario)
    if (p) return [p]
    const r = runtime.get(opts.scenario)
    if (r) return [r]
    return []
  }

  return []
}
