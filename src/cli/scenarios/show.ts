import type { Command } from 'commander'
import { ScenarioRegistry } from '../../core/registry.js'
import { pack, scenarios } from '../../scenarios/preventive-baseline/index.js'
import { header, field, section, indent, blank } from '../output.js'

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

      if (scenario.packMembership && scenario.packMembership.length > 0) {
        section('Pack Membership')
        for (const p of scenario.packMembership) {
          indent(`- ${p}`)
        }
      }

      blank()
    })
}
