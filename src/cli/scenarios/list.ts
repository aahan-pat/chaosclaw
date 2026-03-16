import type { Command } from 'commander'
import { ScenarioRegistry } from '../../core/registry.js'
import { pack, scenarios } from '../../scenarios/preventive-baseline/index.js'
import { header, section, blank } from '../output.js'
import chalk from 'chalk'

export function registerListCommand(scenariosCmd: Command): void {
  scenariosCmd
    .command('list')
    .description('List available scenario packs and scenarios')
    .option('--pack <id>', 'Filter scenarios by pack')
    .action((opts: { pack?: string }) => {
      const registry = new ScenarioRegistry()
      registry.registerPack(pack)
      for (const s of scenarios) registry.register(s)

      header('Available Scenario Packs')
      const packs = registry.listPacks()
      for (const p of packs) {
        const count = `${p.scenarioIds.length} scenarios`
        console.log(`  ${chalk.bold(p.id.padEnd(24))} ${chalk.dim(count.padEnd(14))} ${p.description}`)
      }

      const listed = opts.pack
        ? registry.getScenariosForPack(opts.pack)
        : registry.listScenarios()

      if (listed.length === 0) {
        blank()
        console.log(opts.pack ? `  No scenarios found for pack "${opts.pack}"` : '  No scenarios found')
        return
      }

      section('Available Scenarios')
      for (const s of listed) {
        console.log(`  ${chalk.bold(s.id.padEnd(36))} ${s.description}`)
      }

      blank()
    })
}
