import type { RuntimeAlertSource, RuntimeAlert } from '../runtime-executor.js'

/**
 * Alert source that never returns an alert.
 * Use this when no runtime security tool is installed or when you want to
 * exercise the execution pipeline without a real detection tool.
 * Every runtime scenario will produce `no_alert` as the observed outcome.
 */
export class NullAlertSource implements RuntimeAlertSource {
  readonly name = 'none'

  async isAvailable(): Promise<boolean> {
    return true
  }

  async pollForAlert(
    _namespace: string,
    _podNamePrefix: string,
    _windowStart: string,
    _windowMs: number,
  ): Promise<RuntimeAlert | null> {
    return null
  }
}
