// In-memory registry that holds all known scenarios and packs for a single run.
// Scenarios are keyed by their string ID; packs reference scenario IDs by value.
import type { ScenarioDefinition, ScenarioPack } from '../types/scenario.js'

/**
 * Central store for scenario and pack definitions.
 * Callers register definitions at startup, then query them during execution.
 */
export class ScenarioRegistry {
  private readonly scenarios = new Map<string, ScenarioDefinition>()
  private readonly packs = new Map<string, ScenarioPack>()

  /** Add a single scenario definition to the registry */
  register(scenario: ScenarioDefinition): void {
    this.scenarios.set(scenario.id, scenario)
  }

  /** Add a scenario pack (a named list of scenario IDs) to the registry */
  registerPack(pack: ScenarioPack): void {
    this.packs.set(pack.id, pack)
  }

  /** Look up a scenario by its ID; returns undefined when not found */
  getScenario(id: string): ScenarioDefinition | undefined {
    return this.scenarios.get(id)
  }

  /** Look up a pack by its ID; returns undefined when not found */
  getPack(id: string): ScenarioPack | undefined {
    return this.packs.get(id)
  }

  /**
   * Resolve a pack to its constituent scenario definitions.
   * IDs that are registered in the pack but missing from the registry are silently dropped.
   */
  getScenariosForPack(packId: string): ScenarioDefinition[] {
    const pack = this.packs.get(packId)
    if (!pack) return []
    return pack.scenarioIds
      .map(id => this.scenarios.get(id))
      // Narrow out undefined in case a pack references an unregistered scenario
      .filter((s): s is ScenarioDefinition => s !== undefined)
  }

  /** Return all registered scenarios as a flat array */
  listScenarios(): ScenarioDefinition[] {
    return Array.from(this.scenarios.values())
  }

  /** Return all registered packs as a flat array */
  listPacks(): ScenarioPack[] {
    return Array.from(this.packs.values())
  }

  hasScenario(id: string): boolean {
    return this.scenarios.has(id)
  }

  hasPack(id: string): boolean {
    return this.packs.has(id)
  }
}
