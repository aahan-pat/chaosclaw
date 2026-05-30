// Scenario: verify that the cluster rejects pods requesting hostPath volume mounts.
import type { ScenarioDefinition } from '../../types/scenario.js'

const PACK_ID = 'preventive-baseline'

export const scenario: ScenarioDefinition = {
  id: 'deny-hostpath',
  version: 1,
  name: 'hostPath mount denied',
  description: 'Attempts to create a pod that mounts a hostPath volume. The cluster should reject it.',
  category: 'preventive',
  controlObjective: 'Prevent hostPath volume usage',
  packMembership: [PACK_ID],
  prerequisites: [
    { name: 'can_create_pods', description: 'Permission to create pods in the test namespace' },
    { name: 'hostpath_policy', description: 'Admission policy that restricts hostPath volumes' },
  ],
  manifest: {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'chaosclaw-hostpath-test' },
    spec: {
      containers: [
        {
          name: 'test',
          image: 'busybox:1.36',
          volumeMounts: [{ name: 'host-vol', mountPath: '/host' }],
        },
      ],
      volumes: [{ name: 'host-vol', hostPath: { path: '/etc' } }],
    },
  },
  expectedOutcome: { type: 'admission_rejected' },
  cleanup: { deleteCreatedResources: true },
  safety: { level: 'low', namespaceScoped: true },
}
