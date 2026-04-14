// Assembles the full commander CLI tree.
// Each command group is built in its own module and attached here to keep this
// file a thin composition root rather than a monolithic command handler.
import { Command } from 'commander'
import { registerPreflightCommand } from './verify/preflight.js'
import { registerRunCommand } from './verify/run.js'
import { registerListCommand } from './scenarios/list.js'
import { registerShowCommand } from './scenarios/show.js'

/**
 * Constructs and returns the fully configured commander program.
 * Subcommand groups (verify, scenarios) are registered here; each group's
 * individual subcommands are registered inside their own modules.
 */
export function buildProgram(): Command {
  const program = new Command()

  program
    .name('chaosclaw')
    .description('Deterministic CLI for Kubernetes Continuous Control Verification')
    .version('0.1.0')

  program
    .command('version')
    .description('Print the chaosclaw version')
    .action(() => {
      console.log(`chaosclaw v${program.version()}`)
    })

  // chaosclaw verify preflight | run
  const verify = program
    .command('verify')
    .description('Run verification checks against a Kubernetes cluster')

  registerPreflightCommand(verify)
  registerRunCommand(verify)

  // chaosclaw scenarios list | show
  const scenariosCmd = program
    .command('scenarios')
    .description('Discover and inspect available scenarios and packs')

  registerListCommand(scenariosCmd)
  registerShowCommand(scenariosCmd)

  return program
}
