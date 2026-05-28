// Assembles the full commander CLI tree.
// Each command group is built in its own module and attached here to keep this
// file a thin composition root rather than a monolithic command handler.
import { Command } from 'commander'
import { registerPreflightCommand } from './verify/preflight.js'
import { registerRunCommand } from './verify/run.js'
import { registerExecCommand } from './verify/exec.js'
import { registerNetworkCommand } from './verify/network.js'
import { registerIdentityCommand } from './verify/identity.js'
import { registerDetectCommand } from './verify/detect.js'
import { registerListCommand } from './scenarios/list.js'
import { registerShowCommand } from './scenarios/show.js'
import { registerInitCommand } from './recon/init.js'
import { registerWebhooksCommand } from './recon/webhooks.js'
import { registerPoliciesCommand } from './recon/policies.js'
import { registerPsaCommand } from './recon/psa.js'
import { registerRbacCommand } from './recon/rbac.js'
import { registerNodesCommand } from './recon/nodes.js'
import { registerNetworkPoliciesCommand } from './recon/network-policies.js'
import { registerRuntimeAgentsCommand } from './recon/runtime-agents.js'
import { registerAllCommand } from './recon/all.js'
import { registerTopologyCommand } from './recon/topology.js'

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
  registerExecCommand(verify)
  registerNetworkCommand(verify)
  registerIdentityCommand(verify)
  registerDetectCommand(verify)

  // chaosclaw scenarios list | show
  const scenariosCmd = program
    .command('scenarios')
    .description('Discover and inspect available scenarios and packs')

  registerListCommand(scenariosCmd)
  registerShowCommand(scenariosCmd)

  // chaosclaw recon init | webhooks | policies | psa | rbac | nodes | network-policies | runtime-agents | topology | all
  const reconCmd = program
    .command('recon')
    .description('Survey cluster security posture before pentest execution')

  registerInitCommand(reconCmd)
  registerWebhooksCommand(reconCmd)
  registerPoliciesCommand(reconCmd)
  registerPsaCommand(reconCmd)
  registerRbacCommand(reconCmd)
  registerNodesCommand(reconCmd)
  registerNetworkPoliciesCommand(reconCmd)
  registerRuntimeAgentsCommand(reconCmd)
  registerTopologyCommand(reconCmd)
  registerAllCommand(reconCmd)

  return program
}
