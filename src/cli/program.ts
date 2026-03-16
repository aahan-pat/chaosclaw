import { Command } from 'commander'
import { registerPreflightCommand } from './verify/preflight.js'
import { registerRunCommand } from './verify/run.js'
import { registerListCommand } from './scenarios/list.js'
import { registerShowCommand } from './scenarios/show.js'

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('chaosclaw')
    .description('Deterministic CLI for Kubernetes Continuous Control Verification')
    .version('0.1.0')

  // chaosclaw verify ...
  const verify = program
    .command('verify')
    .description('Run verification checks against a Kubernetes cluster')

  registerPreflightCommand(verify)
  registerRunCommand(verify)

  // chaosclaw scenarios ...
  const scenariosCmd = program
    .command('scenarios')
    .description('Discover and inspect available scenarios and packs')

  registerListCommand(scenariosCmd)
  registerShowCommand(scenariosCmd)

  return program
}
