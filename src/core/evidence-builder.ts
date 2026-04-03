// Accumulates scenario results during a run and assembles the final RunEvidence artifact.
// The artifact is the primary audit output — it can be written to disk as JSON for
// integration with CI pipelines or compliance tooling.
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { ScenarioResult, RunEvidence, RunSummary } from '../types/evidence.js'

/** Pinned at build time so evidence artifacts are self-describing */
const VERSION = '0.1.0'

/** Metadata provided once at the start of a run (before any scenarios execute) */
export interface EvidenceBuilderOptions {
  clusterContext: string
  packId?: string
  packVersion?: string
  /** Set when a single scenario was targeted rather than a full pack */
  scenarioId?: string
  startedAt: string
}

/**
 * Collects ScenarioResult objects as scenarios complete, then assembles a
 * RunEvidence document that can be serialised to JSON.
 * A new UUID is generated per instance so concurrent runs produce distinct artifacts.
 */
export class EvidenceBuilder {
  /** Stable identifier for this run — generated at construction time */
  private readonly runId = randomUUID()
  private readonly results: ScenarioResult[] = []
  private readonly options: EvidenceBuilderOptions

  constructor(options: EvidenceBuilderOptions) {
    this.options = options
  }

  /** Append the result of one scenario execution to this run's evidence */
  addResult(result: ScenarioResult): void {
    this.results.push(result)
  }

  /**
   * Assemble the final RunEvidence document.
   * Call this once all scenarios have finished; pass the current timestamp as endedAt.
   */
  build(endedAt: string): RunEvidence {
    const summary = this.summarize()
    return {
      runId: this.runId,
      toolVersion: VERSION,
      clusterContext: this.options.clusterContext,
      // Attribute the run to the OS user for audit trail purposes
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

  /** Write the evidence document to a JSON file for use as a CI artefact */
  async writeToFile(filePath: string, evidence: RunEvidence): Promise<void> {
    await writeFile(filePath, JSON.stringify(evidence, null, 2), 'utf-8')
  }

  /** Reduce all results into a flat count-per-status summary */
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
