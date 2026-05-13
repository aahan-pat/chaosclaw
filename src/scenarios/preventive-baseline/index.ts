// Barrel for the preventive-baseline pack — imports each scenario from its own file
// and re-exports them together so consumers only need a single import.
import type { ScenarioPack } from '../../types/scenario.js'
import { scenario as denyPrivilegedContainer } from './deny-privileged-container.js'
import { scenario as denyUnapprovedRegistry } from './deny-unapproved-registry.js'
import { scenario as denyHostpath } from './deny-hostpath.js'
import { scenario as denyForbiddenCapabilities } from './deny-forbidden-capabilities.js'
import { scenario as denyLatestTag } from './deny-latest-tag.js'
import { scenario as denyPrivilegeEscalation } from './deny-privilege-escalation.js'
import { scenario as denyHostNetwork } from './deny-host-network.js'

/**
 * The preventive-baseline pack groups the core guardrail scenarios together
 * so they can be run as a single suite: `chaosclaw verify run --pack preventive-baseline`
 */
export const pack: ScenarioPack = {
  id: 'preventive-baseline',
  version: 1,
  name: 'Preventive Baseline',
  description: 'Core preventive guardrail checks for Kubernetes clusters',
  scenarioIds: [
    'deny-privileged-container',
    'deny-unapproved-registry',
    'deny-hostpath',
    'deny-forbidden-capabilities',
    'deny-latest-tag',
    'deny-privilege-escalation',
    'deny-host-network',
  ],
}

export const scenarios = [
  denyPrivilegedContainer,
  denyUnapprovedRegistry,
  denyHostpath,
  denyForbiddenCapabilities,
  denyLatestTag,
  denyPrivilegeEscalation,
  denyHostNetwork,
]
