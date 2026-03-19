import type { ScenarioDefinition } from '../../types/scenario.js'

const PACK_ID = 'preventive-baseline'

export const scenario: ScenarioDefinition = {
  id: 'deny-latest-tag',
  version: 1,
  name: 'Latest image tag denied',
  description: 'Attempts to create a pod using the :latest image tag. The cluster should reject it.',
  category: 'preventive',
  controlObjective: 'Prevent mutable image tags',
  packMembership: [PACK_ID],
  prerequisites: [
    { name: 'can_create_pods', description: 'Permission to create pods in the test namespace' },
    { name: 'image_tag_policy', description: 'Admission policy that restricts mutable image tags' },
  ],
  manifest: {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'chaosclaw-latesttag-test' },
    spec: {
      containers: [
        {
          name: 'test',
          image: 'busybox:latest',
        },
      ],
    },
  },
  expectedOutcome: { type: 'admission_rejected' },
  cleanup: { deleteCreatedResources: true },
  safety: { level: 'low', namespaceScoped: true },
}
