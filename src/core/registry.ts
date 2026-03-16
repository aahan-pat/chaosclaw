import type { ScenarioDefinition, ScenarioPack } from '../types/scenario.js'

export class ScenarioRegistry {
  private readonly scenarios = new Map<string, ScenarioDefinition>()
  private readonly packs = new Map<string, ScenarioPack>()

  register(scenario: ScenarioDefinition): void {
    this.scenarios.set(scenario.id, scenario)
  }

  registerPack(pack: ScenarioPack): void {
    this.packs.set(pack.id, pack)
  }

  getScenario(id: string): ScenarioDefinition | undefined {
    return this.scenarios.get(id)
  }

  getPack(id: string): ScenarioPack | undefined {
    return this.packs.get(id)
  }

  getScenariosForPack(packId: string): ScenarioDefinition[] {
    const pack = this.packs.get(packId)
    if (!pack) return []
    return pack.scenarioIds
      .map(id => this.scenarios.get(id))
      .filter((s): s is ScenarioDefinition => s !== undefined)
  }

  listScenarios(): ScenarioDefinition[] {
    return Array.from(this.scenarios.values())
  }

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
