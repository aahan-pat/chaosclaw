import type { Command } from 'commander'
import { ScenarioRegistry } from '../../core/registry.js'
import { pack as preventivePack, scenarios as preventiveScenarios } from '../../scenarios/preventive-baseline/index.js'
import { pack as runtimePack, scenarios as runtimeScenarios } from '../../scenarios/runtime-baseline/index.js'
import type { RuntimeScenarioDefinition } from '../../types/runtime-scenario.js'
import { header, section, blank } from '../output.js'
import chalk from 'chalk'

export function registerInitializeToolCommand(scenariosCmd: Command): void {
    scenariosCmd
        .command('initialize')
        .description('Initialize default namespace')
        .option('--existing <id>', 'Select existing namespace')
        .action((opts: { pack?: string }) => {

        })
}
