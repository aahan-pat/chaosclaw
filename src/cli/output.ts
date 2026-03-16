import chalk from 'chalk'
import type { ScenarioOutcome } from '../types/evidence.js'
import type { PreflightCheckStatus } from '../core/preflight.js'

export const status = {
  pass: chalk.green('[PASS]'),
  fail: chalk.red('[FAIL]'),
  error: chalk.red('[ERROR]'),
  skipped: chalk.yellow('[SKIPPED]'),
  warn: chalk.yellow('[WARN]'),
}

export function outcomeLabel(outcome: ScenarioOutcome): string {
  switch (outcome) {
    case 'Pass': return status.pass
    case 'Fail': return status.fail
    case 'Error': return status.error
    case 'Skipped': return status.skipped
  }
}

export function preflightLabel(s: PreflightCheckStatus): string {
  switch (s) {
    case 'pass': return status.pass
    case 'fail': return status.fail
    case 'warn': return status.warn
  }
}

export function header(title: string): void {
  console.log()
  console.log(chalk.bold(title))
}

export function field(key: string, value: string): void {
  console.log(`${chalk.dim(key + ':')} ${value}`)
}

export function section(title: string): void {
  console.log()
  console.log(chalk.bold(title))
}

export function indent(text: string, depth = 2): void {
  console.log(' '.repeat(depth) + text)
}

export function blank(): void {
  console.log()
}
