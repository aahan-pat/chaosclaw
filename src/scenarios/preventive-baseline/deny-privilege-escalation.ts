// Scenario: verify that the cluster rejects pods that explicitly allow privilege escalation.
import type { ScenarioDefinition } from '../../types/scenario.js'

const PACK_ID = 'preventive-baseline'

export const scenario: ScenarioDefinition = {
  id: 'deny-privilege-escalation',
  version: 1,
  name: 'Privilege escalation denied',
  description:
    'Attempts to create a pod that explicitly allows privilege escalation and runs as root. ' +
    'The cluster should reject it. This tests whether admission policies prevent containers ' +
    'from gaining additional privileges beyond their parent process, a common RBAC escalation vector.',
  category: 'preventive',
  controlObjective: 'Prevent container privilege escalation',
  packMembership: [PACK_ID],
  prerequisites: [
    { name: 'can_create_pods', description: 'Permission to create pods in the test namespace' },
    { name: 'admission_policy', description: 'Admission policy that restricts privilege escalation (e.g. PSA restricted, Kyverno, OPA Gatekeeper)' },
  ],
  manifest: {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'chaosclaw-privilege-escalation-test' },
    spec: {
      containers: [
        {
          name: 'test',
          image: 'busybox:1.36',
          securityContext: {
            allowPrivilegeEscalation: true,
            runAsUser: 0,
          },
        },
      ],
    },
  },
  expectedOutcome: { type: 'admission_rejected' },
  cleanup: { deleteCreatedResources: true },
  safety: { level: 'low', namespaceScoped: true },
}
