// Implements the "chaosclaw scenarios show <id>" command.
// Prints a detailed view of a single scenario — useful for understanding what
// a scenario does before running it, or for troubleshooting a failed result.
import type { Command } from 'commander'
import { ScenarioRegistry } from '../../core/registry.js'
import { pack, scenarios } from '../../scenarios/preventive-baseline/index.js'
import { header, field, section, indent, blank } from '../output.js'

/**
 * Attaches the "show <id>" subcommand to the given parent command.
 * Exits with code 4 if the requested scenario ID is not found in the registry.
 */
export function registerShowCommand(scenariosCmd: Command): void {
  scenariosCmd
    .command('show <id>')
    .description('Show details for a specific scenario')
    .action((id: string) => {
      const registry = new ScenarioRegistry()
      registry.registerPack(pack)
      for (const s of scenarios) registry.register(s)

      const scenario = registry.getScenario(id)
      if (!scenario) {
        console.error(`\nError\n  Scenario not found: "${id}"`)
        console.error('\n  Run "chaosclaw scenarios list" to see available scenarios')
        process.exit(4)
      }

      header(`Scenario: ${scenario.id}`)
      field('Version', String(scenario.version))
      field('Category', scenario.category)
      field('Control Objective', scenario.controlObjective)
      // Display as human-readable "admission rejected" rather than the raw enum value
      field('Expected Outcome', scenario.expectedOutcome.type.replace('_', ' '))
      field('Risk Level', scenario.safety.level)

      section('Description')
      indent(scenario.description)

      if (scenario.prerequisites.length > 0) {
        section('Prerequisites')
        for (const p of scenario.prerequisites) {
          indent(`- ${p.description}`)
        }
      }

      // Show which packs include this scenario so users know how to run it as part of a suite
      if (scenario.packMembership && scenario.packMembership.length > 0) {
        section('Pack Membership')
        for (const p of scenario.packMembership) {
          indent(`- ${p}`)
        }
      }

      blank()
    })
}
