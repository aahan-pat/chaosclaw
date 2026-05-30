// Scenario: verify that the cluster rejects pods requesting access to the host network namespace.
import type { ScenarioDefinition } from '../../types/scenario.js'

const PACK_ID = 'preventive-baseline'

export const scenario: ScenarioDefinition = {
  id: 'deny-host-network',
  version: 1,
  name: 'Host network denied',
  description: 'Attempts to create a pod with hostNetwork: true. The cluster should reject it.',
  category: 'preventive',
  controlObjective: 'Prevent pods from accessing the host network namespace',
  packMembership: [PACK_ID],
  prerequisites: [
    { name: 'can_create_pods', description: 'Permission to create pods in the test namespace' },
    { name: 'host_network_policy', description: 'Admission policy that restricts hostNetwork usage' },
  ],
  manifest: {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'chaosclaw-host-network-test' },
    spec: {
      hostNetwork: true,
      containers: [
        {
          name: 'test',
          image: 'busybox:1.36',
          command: ['sleep', '3600'],
        },
      ],
    },
  },
  expectedOutcome: { type: 'admission_rejected' },
  cleanup: { deleteCreatedResources: true },
  safety: { level: 'low', namespaceScoped: true },
}
