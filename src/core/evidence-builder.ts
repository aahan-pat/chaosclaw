import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { ScenarioResult, RunEvidence, RunSummary } from '../types/evidence.js'

const VERSION = '0.1.0'

export interface EvidenceBuilderOptions {
  clusterContext: string
  packId?: string
  packVersion?: string
  scenarioId?: string
  startedAt: string
}

export class EvidenceBuilder {
  private readonly runId = randomUUID()
  private readonly results: ScenarioResult[] = []
  private readonly options: EvidenceBuilderOptions

  constructor(options: EvidenceBuilderOptions) {
    this.options = options
  }

  addResult(result: ScenarioResult): void {
    this.results.push(result)
  }

  build(endedAt: string): RunEvidence {
    const summary = this.summarize()
    return {
      runId: this.runId,
      toolVersion: VERSION,
      clusterContext: this.options.clusterContext,
      initiatedBy: process.env['USER'] ?? 'unknown',
      packId: this.options.packId,
      packVersion: this.options.packVersion !== undefined ? String(this.options.packVersion) : undefined,
      scenarioId: this.options.scenarioId,
      startedAt: this.options.startedAt,
      endedAt,
      summary,
      results: this.results,
    }
  }

  async writeToFile(filePath: string, evidence: RunEvidence): Promise<void> {
    await writeFile(filePath, JSON.stringify(evidence, null, 2), 'utf-8')
  }

  private summarize(): RunSummary {
    return this.results.reduce<RunSummary>(
      (acc, r) => {
        switch (r.status) {
          case 'Pass': return { ...acc, pass: acc.pass + 1 }
          case 'Fail': return { ...acc, fail: acc.fail + 1 }
          case 'Error': return { ...acc, error: acc.error + 1 }
          case 'Skipped': return { ...acc, skipped: acc.skipped + 1 }
        }
      },
      { pass: 0, fail: 0, error: 0, skipped: 0 },
    )
  }
}
