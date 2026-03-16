import type { ScenarioDefinition, ScenarioPack } from '../../types/scenario.js'

const PACK_ID = 'preventive-baseline'

export const pack: ScenarioPack = {
  id: PACK_ID,
  version: 1,
  name: 'Preventive Baseline',
  description: 'Core preventive guardrail checks for Kubernetes clusters',
  scenarioIds: [
    'deny-privileged-container',
    'deny-unapproved-registry',
    'deny-hostpath',
    'deny-forbidden-capabilities',
    'deny-latest-tag',
  ],
}

export const scenarios: ScenarioDefinition[] = [
  {
    id: 'deny-privileged-container',
    version: 1,
    name: 'Privileged container denied',
    description: 'Attempts to create a pod running in privileged mode. The cluster should reject it.',
    category: 'preventive',
    controlObjective: 'Prevent privileged workloads',
    packMembership: [PACK_ID],
    prerequisites: [
      { name: 'can_create_pods', description: 'Permission to create pods in the test namespace' },
      { name: 'admission_policy', description: 'Admission policy that restricts privileged containers' },
    ],
    manifest: {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'chaosclaw-privileged-test' },
      spec: {
        containers: [
          {
            name: 'test',
            image: 'busybox:1.36',
            securityContext: { privileged: true },
          },
        ],
      },
    },
    expectedOutcome: { type: 'admission_rejected' },
    cleanup: { deleteCreatedResources: true },
    safety: { level: 'low', namespaceScoped: true },
  },

  {
    id: 'deny-unapproved-registry',
    version: 1,
    name: 'Unapproved registry denied',
    description: 'Attempts to create a pod using an image from an unapproved registry. The cluster should reject it.',
    category: 'preventive',
    controlObjective: 'Restrict disallowed image registries',
    packMembership: [PACK_ID],
    prerequisites: [
      { name: 'can_create_pods', description: 'Permission to create pods in the test namespace' },
      { name: 'registry_policy', description: 'Admission policy that restricts image registries' },
    ],
    manifest: {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'chaosclaw-registry-test' },
      spec: {
        containers: [
          {
            name: 'test',
            image: 'docker.io/unapproved-vendor/app:1.0.0',
          },
        ],
      },
    },
    expectedOutcome: { type: 'admission_rejected' },
    cleanup: { deleteCreatedResources: true },
    safety: { level: 'low', namespaceScoped: true },
  },

  {
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
  },

  {
    id: 'deny-forbidden-capabilities',
    version: 1,
    name: 'Forbidden Linux capabilities denied',
    description: 'Attempts to create a pod requesting a dangerous Linux capability (NET_ADMIN). The cluster should reject it.',
    category: 'preventive',
    controlObjective: 'Restrict dangerous Linux capabilities',
    packMembership: [PACK_ID],
    prerequisites: [
      { name: 'can_create_pods', description: 'Permission to create pods in the test namespace' },
      { name: 'capabilities_policy', description: 'Admission policy that restricts Linux capabilities' },
    ],
    manifest: {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'chaosclaw-capabilities-test' },
      spec: {
        containers: [
          {
            name: 'test',
            image: 'busybox:1.36',
            securityContext: { capabilities: { add: ['NET_ADMIN'] } },
          },
        ],
      },
    },
    expectedOutcome: { type: 'admission_rejected' },
    cleanup: { deleteCreatedResources: true },
    safety: { level: 'low', namespaceScoped: true },
  },

  {
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
  },
]
