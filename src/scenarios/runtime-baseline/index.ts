// Barrel for the runtime-baseline pack — exports the pack definition and its scenario array
// so consumers can register them with a single import.
import type { RuntimeScenarioDefinition, ScenarioPack } from '../../types/runtime-scenario.js'
import { readSensitiveFile } from './read-sensitive-file.js'

export const pack: ScenarioPack = {
  id: 'runtime-baseline',
  version: 1,
  name: 'Runtime Baseline',
  description:
    'Baseline runtime detection scenarios. Requires a runtime security tool ' +
    '(Falco, Tetragon, or KubeArmor) to be installed on the cluster.',
  scenarioIds: ['detect-read-sensitive-file'],
}

// Export as a typed array so consumers can iterate over scenarios without individual imports.
export const scenarios: RuntimeScenarioDefinition[] = [readSensitiveFile]
