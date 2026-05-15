// Shared terminal output helpers used by all CLI commands.
// Centralises chalk styling so colour and layout are consistent across commands.
import chalk from 'chalk'
import type { ScenarioOutcome } from '../types/evidence.js'
import type { PreflightCheckStatus } from '../core/preflight.js'
import type { ReconFinding, ReconFindingSeverity } from '../types/recon.js'

/** Pre-built coloured status badges used inline in output lines */
export const status = {
  pass: chalk.green('[PASS]'),
  fail: chalk.red('[FAIL]'),
  error: chalk.red('[ERROR]'),
  skipped: chalk.yellow('[SKIPPED]'),
  warn: chalk.yellow('[WARN]'),
}

/** Maps a ScenarioOutcome enum value to its coloured badge string */
export function outcomeLabel(outcome: ScenarioOutcome): string {
  switch (outcome) {
    case 'Pass': return status.pass
    case 'Fail': return status.fail
    case 'Error': return status.error
    case 'Skipped': return status.skipped
  }
}

/** Maps a PreflightCheckStatus to its coloured badge string */
export function preflightLabel(s: PreflightCheckStatus): string {
  switch (s) {
    case 'pass': return status.pass
    case 'fail': return status.fail
    case 'warn': return status.warn
  }
}

/** Print a bold section title preceded by a blank line */
export function header(title: string): void {
  console.log()
  console.log(chalk.bold(title))
}

/** Print a dimmed key followed by its value on a single line */
export function field(key: string, value: string): void {
  console.log(`${chalk.dim(key + ':')} ${value}`)
}

/** Print a bold sub-section heading preceded by a blank line */
export function section(title: string): void {
  console.log()
  console.log(chalk.bold(title))
}

/** Print text indented by depth spaces (default 2) */
export function indent(text: string, depth = 2): void {
  console.log(' '.repeat(depth) + text)
}

/** Print an empty line for vertical spacing */
export function blank(): void {
  console.log()
}

/** Maps a ReconFindingSeverity to its coloured badge string */
export function reconFindingLabel(severity: ReconFindingSeverity): string {
  switch (severity) {
    case 'CRITICAL': return chalk.red('[CRITICAL]')
    case 'HIGH':     return chalk.red('[HIGH]')
    case 'WARN':     return chalk.yellow('[WARN]')
    case 'INFO':     return chalk.dim('[INFO]')
    case 'SKIP':     return chalk.yellow('[SKIP]')
  }
}

/** Print the Findings section for any recon command — shared across all recon CLI modules */
export function renderReconFindings(findings: ReconFinding[]): void {
  if (findings.length === 0) return
  section('Findings')
  for (const f of findings) {
    blank()
    indent(`${reconFindingLabel(f.severity)} ${f.title}`)
    indent(f.detail, 9)
    if (f.coverageImpact) indent(`Impact: ${f.coverageImpact}`, 9)
  }
}
