// Shared utilities used by all recon CLI commands.
import { writeFile } from 'node:fs/promises'
import * as k8s from '@kubernetes/client-node'

export const DEFAULT_RECON_NAMESPACE = 'chaosclaw'

/** Build a KubeConfig, optionally switching context, and return the active context name. */
export function buildKubeConfig(context?: string): { kc: k8s.KubeConfig; clusterContext: string } {
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()
  if (context) kc.setCurrentContext(context)
  return { kc, clusterContext: kc.getCurrentContext() }
}

/** Write arbitrary data as formatted JSON to a file path. */
export async function writeJsonToFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
