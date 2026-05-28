import { describe, it, expect, vi } from 'vitest'
import * as k8s from '@kubernetes/client-node'
import { WebhookReconEngine } from '../../../../src/core/recon/webhooks.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AdmissionApiStub = {
  listValidatingWebhookConfiguration: ReturnType<typeof vi.fn>
  listMutatingWebhookConfiguration: ReturnType<typeof vi.fn>
}

function makeKc(stub: Partial<AdmissionApiStub> = {}): k8s.KubeConfig {
  const api: AdmissionApiStub = {
    listValidatingWebhookConfiguration: vi.fn().mockResolvedValue({ items: [] }),
    listMutatingWebhookConfiguration: vi.fn().mockResolvedValue({ items: [] }),
    ...stub,
  }
  return {
    makeApiClient: vi.fn().mockReturnValue(api),
  } as unknown as k8s.KubeConfig
}

function makeValidatingConfig(webhooks: Partial<k8s.V1ValidatingWebhook>[]): k8s.V1ValidatingWebhookConfiguration {
  return {
    metadata: { name: 'test-config' },
    webhooks: webhooks.map(wh => ({
      name: wh.name ?? 'test-webhook.example.com',
      admissionReviewVersions: ['v1'],
      clientConfig: {},
      sideEffects: 'None',
      failurePolicy: wh.failurePolicy ?? 'Fail',
      ...wh,
    })),
  }
}

const RECON_OPTIONS = { namespace: 'chaosclaw' }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookReconEngine', () => {
  describe('no webhooks', () => {
    it('returns a HIGH finding when no admission webhooks exist', async () => {
      const kc = makeKc()
      const engine = new WebhookReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      expect(result.status).toBe('ok')
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]?.severity).toBe('HIGH')
      expect(result.findings[0]?.title).toMatch(/no admission webhooks/i)
    })
  })

  describe('fail-open webhooks', () => {
    it('emits a HIGH finding per webhook with failurePolicy: Ignore', async () => {
      const kc = makeKc({
        listValidatingWebhookConfiguration: vi.fn().mockResolvedValue({
          items: [
            makeValidatingConfig([
              { name: 'policy.example.com', failurePolicy: 'Ignore' },
              { name: 'strict.example.com', failurePolicy: 'Fail' },
            ]),
          ],
        }),
      })
      const engine = new WebhookReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      const highFindings = result.findings.filter(f => f.severity === 'HIGH')
      expect(highFindings).toHaveLength(1)
      expect(highFindings[0]?.title).toContain('policy.example.com')
    })

    it('emits one HIGH finding per fail-open webhook when multiple exist', async () => {
      const kc = makeKc({
        listValidatingWebhookConfiguration: vi.fn().mockResolvedValue({
          items: [
            makeValidatingConfig([
              { name: 'wh1.example.com', failurePolicy: 'Ignore' },
              { name: 'wh2.example.com', failurePolicy: 'Ignore' },
            ]),
          ],
        }),
      })
      const engine = new WebhookReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      const highFindings = result.findings.filter(f => f.severity === 'HIGH')
      expect(highFindings).toHaveLength(2)
    })
  })

  describe('all fail-closed', () => {
    it('returns an INFO finding when all webhooks use failurePolicy: Fail', async () => {
      const kc = makeKc({
        listValidatingWebhookConfiguration: vi.fn().mockResolvedValue({
          items: [makeValidatingConfig([{ name: 'strict.example.com', failurePolicy: 'Fail' }])],
        }),
      })
      const engine = new WebhookReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      expect(result.findings).toHaveLength(1)
      expect(result.findings[0]?.severity).toBe('INFO')
      expect(result.findings[0]?.title).toMatch(/failurePolicy: Fail/i)
    })
  })

  describe('RBAC error (403)', () => {
    it('returns skip status with a SKIP finding when the API returns 403', async () => {
      const err = Object.assign(new Error('Forbidden'), { code: 403 })
      const kc = makeKc({
        listValidatingWebhookConfiguration: vi.fn().mockRejectedValue(err),
        listMutatingWebhookConfiguration: vi.fn().mockRejectedValue(err),
      })
      const engine = new WebhookReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      expect(result.status).toBe('skip')
      expect(result.findings[0]?.severity).toBe('SKIP')
      expect(result.findings[0]?.missingPermission).toBeDefined()
    })
  })

  describe('result data', () => {
    it('includes the webhook list in result.data', async () => {
      const kc = makeKc({
        listValidatingWebhookConfiguration: vi.fn().mockResolvedValue({
          items: [makeValidatingConfig([{ name: 'my-webhook.example.com', failurePolicy: 'Fail' }])],
        }),
      })
      const engine = new WebhookReconEngine(kc)

      const result = await engine.run(RECON_OPTIONS)

      const data = result.data as { webhooks: unknown[] }
      expect(data.webhooks).toHaveLength(1)
    })
  })
})
