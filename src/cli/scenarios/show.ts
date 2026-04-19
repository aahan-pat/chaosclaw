// Implements the "chaosclaw scenarios show <id>" command.
// Prints a detailed view of a single scenario — useful for understanding what
// a scenario does before running it, or for troubleshooting a failed result.
import type { Command } from 'commander'
import { ScenarioRegistry } from '../../core/registry.js'
import { pack, scenarios } from '../../scenarios/preventive-baseline/index.js'
import { scenarios as runtimeScenarios } from '../../scenarios/runtime-baseline/index.js'
import type { RuntimeScenarioDefinition } from '../../types/runtime-scenario.js'
import { header, field, section, indent, blank } from '../output.js'

function isRuntimeScenario(s: unknown): s is RuntimeScenarioDefinition {
  return typeof s === 'object' && s !== null && 'execStep' in s
}

/**
 * Attaches the "show <id>" subcommand to the given parent command.
 * Exits with code 4 if the requested scenario ID is not found in either registry.
 */
export function registerShowCommand(scenariosCmd: Command): void {
  scenariosCmd
    .command('show <id>')
    .description('Show details for a specific scenario')
    .action((id: string) => {
      const registry = new ScenarioRegistry()
      registry.registerPack(pack)
      for (const s of scenarios) registry.register(s)

      const runtimeById = new Map<string, RuntimeScenarioDefinition>(runtimeScenarios.map(s => [s.id, s]))

      const scenario = registry.getScenario(id) ?? runtimeById.get(id)
      if (!scenario) {
        console.error(`\nError\n  Scenario not found: "${id}"`)
        console.error('\n  Run "chaosclaw scenarios list" to see available scenarios')
        process.exit(4)
      }

      header(`Scenario: ${scenario.id}`)
      field('Version', String(scenario.version))
      field('Category', scenario.category)
      field('Control Objective', scenario.controlObjective)
      field('Expected Outcome', scenario.expectedOutcome.type.replace('_', ' '))
      field('Risk Level', scenario.safety.level)

      section('Description')
      indent(scenario.description)

      if (isRuntimeScenario(scenario)) {
        section('Exec Step')
        indent(`Container: ${scenario.execStep.container}`)
        indent(`Command:   ${scenario.execStep.command.join(' ')}`)
        if (scenario.execStep.timeoutMs) indent(`Timeout:   ${scenario.execStep.timeoutMs}ms`)
      }

      if (scenario.prerequisites.length > 0) {
        section('Prerequisites')
        for (const p of scenario.prerequisites) {
          indent(`- ${p.description}`)
        }
      }

      if (scenario.packMembership && scenario.packMembership.length > 0) {
        section('Pack Membership')
        for (const p of scenario.packMembership) {
          indent(`- ${p}`)
        }
      }

      blank()
    })
}
