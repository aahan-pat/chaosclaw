import { describe, it, expect, vi } from 'vitest'
import * as k8s from '@kubernetes/client-node'
import { RbacReconEngine } from '../../../../src/core/recon/rbac.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RbacApiStub = {
  listClusterRole: ReturnType<typeof vi.fn>
  listClusterRoleBinding: ReturnType<typeof vi.fn>
}

function makeKc(stub: Partial<RbacApiStub> = {}): k8s.KubeConfig {
  const api: RbacApiStub = {
    listClusterRole: vi.fn().mockResolvedValue({ items: [] }),
    listClusterRoleBinding: vi.fn().mockResolvedValue({ items: [] }),
    ...stub,
  }
  return {
    makeApiClient: vi.fn().mockReturnValue(api),
  } as unknown as k8s.KubeConfig
}

function makeAdminBinding(name: string, subjects: k8s.V1Subject[]): k8s.V1ClusterRoleBinding {
  return {
    metadata: { name },
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'cluster-admin' },
    subjects,
  }
}

function makeRole(name: string, rules: k8s.V1PolicyRule[]): k8s.V1ClusterRole {
  return {
    metadata: { name },
    rules,
  }
}

function makeSecretReadRole(name: string): k8s.V1ClusterRole {
  return makeRole(name, [{
    apiGroups: [''],
    resources: ['secrets'],
    verbs: ['get', 'list', 'watch'],
  }])
}

function makeScopedSecretReadRole(name: string): k8s.V1ClusterRole {
  return makeRole(name, [{
    apiGroups: [''],
    resources: ['secrets'],
    verbs: ['get'],
    resourceNames: ['specific-secret'],
  }])
}

const RECON_OPTIONS = { namespace: 'chaosclaw' }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RbacReconEngine', () => {
  describe('cluster-admin bindings', () => {
    it('emits a WARN finding for a non-system cluster-admin binding', async () => {
      const kc = makeKc({
        listClusterRoleBinding: vi.fn().mockResolvedValue({
          items: [
            makeAdminBinding('dev-admin', [
              { kind: 'User', name: 'developer@example.com', apiGroup: 'rbac.authorization.k8s.io' },
            ]),
          ],
        }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      const warnFindings = result.findings.filter(f => f.severity === 'WARN')
      expect(warnFindings).toHaveLength(1)
      expect(warnFindings[0]?.title).toMatch(/cluster-admin/i)
      expect(warnFindings[0]?.detail).toContain('developer@example.com')
    })

    it('does not emit a WARN for subjects in system namespaces when includeSystem is false', async () => {
      const kc = makeKc({
        listClusterRoleBinding: vi.fn().mockResolvedValue({
          items: [
            makeAdminBinding('system-binding', [
              { kind: 'ServiceAccount', name: 'default', namespace: 'kube-system', apiGroup: '' },
            ]),
          ],
        }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run({ ...RECON_OPTIONS, includeSystem: false })

      expect(result.findings.filter(f => f.severity === 'WARN')).toHaveLength(0)
    })

    it('emits a WARN for system-namespace subjects when includeSystem is true', async () => {
      const kc = makeKc({
        listClusterRoleBinding: vi.fn().mockResolvedValue({
          items: [
            makeAdminBinding('system-binding', [
              { kind: 'ServiceAccount', name: 'default', namespace: 'kube-system', apiGroup: '' },
            ]),
          ],
        }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run({ ...RECON_OPTIONS, includeSystem: true })

      expect(result.findings.filter(f => f.severity === 'WARN')).toHaveLength(1)
    })

    it('skips the built-in cluster-admin binding by name', async () => {
      // The binding named 'cluster-admin' that Kubernetes ships with is excluded
      const kc = makeKc({
        listClusterRoleBinding: vi.fn().mockResolvedValue({
          items: [
            makeAdminBinding('cluster-admin', [
              { kind: 'Group', name: 'system:masters', apiGroup: 'rbac.authorization.k8s.io' },
            ]),
          ],
        }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      expect(result.findings.filter(f => f.severity === 'WARN')).toHaveLength(0)
    })
  })

  describe('cluster-wide secret read access', () => {
    it('emits a HIGH finding when a ServiceAccount has broad secret read', async () => {
      const role = makeSecretReadRole('secret-reader')
      const binding: k8s.V1ClusterRoleBinding = {
        metadata: { name: 'app-secret-reader-binding' },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'secret-reader' },
        subjects: [{ kind: 'ServiceAccount', name: 'app-sa', namespace: 'production', apiGroup: '' }],
      }
      const kc = makeKc({
        listClusterRole: vi.fn().mockResolvedValue({ items: [role] }),
        listClusterRoleBinding: vi.fn().mockResolvedValue({ items: [binding] }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      const highFindings = result.findings.filter(f => f.severity === 'HIGH')
      expect(highFindings).toHaveLength(1)
      expect(highFindings[0]?.title).toContain('app-sa')
      expect(highFindings[0]?.title).toContain('production')
    })

    it('does not emit HIGH when secret read is scoped to specific resource names', async () => {
      const role = makeScopedSecretReadRole('scoped-reader')
      const binding: k8s.V1ClusterRoleBinding = {
        metadata: { name: 'scoped-binding' },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'scoped-reader' },
        subjects: [{ kind: 'ServiceAccount', name: 'app-sa', namespace: 'production', apiGroup: '' }],
      }
      const kc = makeKc({
        listClusterRole: vi.fn().mockResolvedValue({ items: [role] }),
        listClusterRoleBinding: vi.fn().mockResolvedValue({ items: [binding] }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      expect(result.findings.filter(f => f.severity === 'HIGH')).toHaveLength(0)
    })

    it('does not emit HIGH for system-namespace service accounts when includeSystem is false', async () => {
      const role = makeSecretReadRole('secret-reader')
      const binding: k8s.V1ClusterRoleBinding = {
        metadata: { name: 'sys-binding' },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'secret-reader' },
        subjects: [{ kind: 'ServiceAccount', name: 'controller', namespace: 'kube-system', apiGroup: '' }],
      }
      const kc = makeKc({
        listClusterRole: vi.fn().mockResolvedValue({ items: [role] }),
        listClusterRoleBinding: vi.fn().mockResolvedValue({ items: [binding] }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run({ ...RECON_OPTIONS, includeSystem: false })

      expect(result.findings.filter(f => f.severity === 'HIGH')).toHaveLength(0)
    })
  })

  describe('RBAC errors (403)', () => {
    it('returns skip status when both list calls return 403', async () => {
      const err = Object.assign(new Error('Forbidden'), { code: 403 })
      const kc = makeKc({
        listClusterRole: vi.fn().mockRejectedValue(err),
        listClusterRoleBinding: vi.fn().mockRejectedValue(err),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      expect(result.status).toBe('skip')
      expect(result.findings.every(f => f.severity === 'SKIP')).toBe(true)
    })

    it('still returns ok when listClusterRole returns 403 but bindings produce analysis findings', async () => {
      const err = Object.assign(new Error('Forbidden'), { code: 403 })
      // A non-system cluster-admin binding will produce a WARN finding even without roles
      const adminBinding = makeAdminBinding('dev-admin', [
        { kind: 'User', name: 'developer@example.com', apiGroup: 'rbac.authorization.k8s.io' },
      ])
      const kc = makeKc({
        listClusterRole: vi.fn().mockRejectedValue(err),
        listClusterRoleBinding: vi.fn().mockResolvedValue({ items: [adminBinding] }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      // Analysis findings exist (WARN) alongside the SKIP finding → status is ok, not skip
      expect(result.status).toBe('ok')
      const skipFindings = result.findings.filter(f => f.severity === 'SKIP')
      expect(skipFindings).toHaveLength(1)
      expect(skipFindings[0]?.missingPermission).toContain('clusterroles')
      expect(result.findings.some(f => f.severity === 'WARN')).toBe(true)
    })
  })

  describe('result data', () => {
    it('reports role and binding counts in result.data', async () => {
      const kc = makeKc({
        listClusterRole: vi.fn().mockResolvedValue({ items: [makeSecretReadRole('r1'), makeSecretReadRole('r2')] }),
        listClusterRoleBinding: vi.fn().mockResolvedValue({ items: [] }),
      })
      const engine = new RbacReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      const data = result.data as { clusterRoleCount: number; clusterRoleBindingCount: number }
      expect(data.clusterRoleCount).toBe(2)
      expect(data.clusterRoleBindingCount).toBe(0)
    })
  })
})
