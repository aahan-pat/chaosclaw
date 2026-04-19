// Implements the "chaosclaw scenarios list" command.
// Displays all registered packs and scenarios, with an optional --pack filter.
import type { Command } from 'commander'
import { ScenarioRegistry } from '../../core/registry.js'
import { pack as preventivePack, scenarios as preventiveScenarios } from '../../scenarios/preventive-baseline/index.js'
import { pack as runtimePack, scenarios as runtimeScenarios } from '../../scenarios/runtime-baseline/index.js'
import type { RuntimeScenarioDefinition } from '../../types/runtime-scenario.js'
import { header, section, blank } from '../output.js'
import chalk from 'chalk'

/**
 * Attaches the "list" subcommand to the given parent command.
 * When --pack is provided, only scenarios belonging to that pack are shown.
 */
export function registerListCommand(scenariosCmd: Command): void {
  scenariosCmd
    .command('list')
    .description('List available scenario packs and scenarios')
    .option('--pack <id>', 'Filter scenarios by pack')
    .action((opts: { pack?: string }) => {
      const registry = new ScenarioRegistry()
      registry.registerPack(preventivePack)
      for (const s of preventiveScenarios) registry.register(s)

      const runtimeById = new Map<string, RuntimeScenarioDefinition>(runtimeScenarios.map(s => [s.id, s]))

      // All packs — preventive from registry, runtime inline
      header('Available Scenario Packs')
      const packs = registry.listPacks()
      for (const p of packs) {
        const count = `${p.scenarioIds.length} scenarios`
        console.log(`  ${chalk.bold(p.id.padEnd(24))} ${chalk.dim(count.padEnd(14))} ${p.description}`)
      }
      {
        const count = `${runtimePack.scenarioIds.length} scenarios`
        console.log(`  ${chalk.bold(runtimePack.id.padEnd(24))} ${chalk.dim(count.padEnd(14))} ${runtimePack.description}`)
      }

      // Determine which scenarios to list
      let listedPreventive = opts.pack
        ? registry.getScenariosForPack(opts.pack)
        : registry.listScenarios()

      let listedRuntime: RuntimeScenarioDefinition[] = []
      if (!opts.pack) {
        listedRuntime = runtimeScenarios
      } else if (opts.pack === runtimePack.id) {
        listedPreventive = []
        listedRuntime = (runtimePack.scenarioIds)
          .map(id => runtimeById.get(id))
          .filter((s): s is RuntimeScenarioDefinition => s !== undefined)
      }

      if (listedPreventive.length === 0 && listedRuntime.length === 0) {
        blank()
        console.log(opts.pack ? `  No scenarios found for pack "${opts.pack}"` : '  No scenarios found')
        return
      }

      section('Available Scenarios')
      for (const s of listedPreventive) {
        console.log(`  ${chalk.bold(s.id.padEnd(36))} ${chalk.dim('preventive')}  ${s.description}`)
      }
      for (const s of listedRuntime) {
        console.log(`  ${chalk.bold(s.id.padEnd(36))} ${chalk.dim('detective ')}  ${s.description}`)
      }

      blank()
    })
}
