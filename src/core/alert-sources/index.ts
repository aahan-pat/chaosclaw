// Factory module for alert source adapters — selects the right implementation based on
// the tool name passed in from CLI flags, defaulting to NullAlertSource when unrecognised.
import * as k8s from '@kubernetes/client-node'
import type { RuntimeAlertSource } from '../runtime-executor.js'
import { NullAlertSource } from './null.js'
import { FalcoAlertSource } from './falco.js'
import { TetragonAlertSource } from './tetragon.js'
import { KubeArmorAlertSource } from './kubearmor.js'

export { NullAlertSource, FalcoAlertSource, TetragonAlertSource, KubeArmorAlertSource }

// Instantiate and return the alert source adapter for the given tool name,
// using NullAlertSource as the safe default when no tool is specified or the name is unrecognised.
export function buildAlertSource(tool: string, kc: k8s.KubeConfig): RuntimeAlertSource {
  switch (tool) {
    case 'falco':     return new FalcoAlertSource(kc)
    case 'tetragon':  return new TetragonAlertSource(kc)
    case 'kubearmor': return new KubeArmorAlertSource(kc)
    case 'none':
    default:          return new NullAlertSource()
  }
}
