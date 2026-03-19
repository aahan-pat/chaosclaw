// Shared terminal output helpers used by all CLI commands.
// Centralises chalk styling so colour and layout are consistent across commands.
import chalk from 'chalk'
import type { ScenarioOutcome } from '../types/evidence.js'
import type { PreflightCheckStatus } from '../core/preflight.js'

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
