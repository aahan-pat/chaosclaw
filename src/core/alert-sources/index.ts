import * as k8s from '@kubernetes/client-node'
import type { RuntimeAlertSource } from '../runtime-executor.js'
import { NullAlertSource } from './null.js'
import { FalcoAlertSource } from './falco.js'
import { TetragonAlertSource } from './tetragon.js'
import { KubeArmorAlertSource } from './kubearmor.js'

export { NullAlertSource, FalcoAlertSource, TetragonAlertSource, KubeArmorAlertSource }

export function buildAlertSource(tool: string, kc: k8s.KubeConfig): RuntimeAlertSource {
  switch (tool) {
    case 'falco':     return new FalcoAlertSource(kc)
    case 'tetragon':  return new TetragonAlertSource(kc)
    case 'kubearmor': return new KubeArmorAlertSource(kc)
    case 'none':
    default:          return new NullAlertSource()
  }
}
