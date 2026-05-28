// Implements "chaosclaw recon all" — runs all recon tools sequentially and assembles a ReconReport.
import { randomUUID } from 'node:crypto'
import type { Command } from 'commander'
import { ReconInitEngine } from '../../core/recon/init.js'
import { WebhookReconEngine } from '../../core/recon/webhooks.js'
import { PolicyReconEngine } from '../../core/recon/policies.js'
import { PsaReconEngine } from '../../core/recon/psa.js'
import { RbacReconEngine } from '../../core/recon/rbac.js'
import { NodeReconEngine } from '../../core/recon/nodes.js'
import { NetworkPolicyReconEngine } from '../../core/recon/network-policies.js'
import { RuntimeAgentReconEngine } from '../../core/recon/runtime-agents.js'
import { TopologyReconEngine } from '../../core/recon/topology.js'
import type { ReconFinding, ReconFindingSeverity, ReconReport, ReconToolResult } from '../../types/recon.js'
import { header, field, section, indent, blank, reconFindingLabel } from '../output.js'
import { buildKubeConfig, DEFAULT_RECON_NAMESPACE, writeJsonToFile } from './shared.js'
import chalk from 'chalk'

/**
 * Attaches the "all" subcommand to the recon group.
 * Runs init + all seven survey tools sequentially. A single tool failure never
 * aborts the survey — it is recorded as status 'error' and the run continues.
 */
export function registerAllCommand(recon: Command): void {
  recon
    .command('all')
    .description('Run all recon tools sequentially and produce a combined ReconReport')
    .option('--context <name>', 'Kubernetes context to use')
    .option('--namespace <name>', 'Recon namespace', DEFAULT_RECON_NAMESPACE)
    .option('--format <mode>', 'Output mode: table, json', 'table')
    .option('--output <path>', 'Write combined JSON ReconReport to file')
    .option('--skip <tools>', 'Comma-separated list of tools to skip (e.g. rbac,nodes)')
    .option('--include-system', 'Include kube-system service accounts in RBAC analysis')
    .action(async (opts: {
      context?: string
      namespace: string
      format: string
      output?: string
      skip?: string
      includeSystem?: boolean
    }) => {
      const { kc, clusterContext } = buildKubeConfig(opts.context)
      const skipSet = new Set((opts.skip ?? '').split(',').map(s => s.trim()).filter(Boolean))
      const startedAt = new Date().toISOString()

      const reconOptions = {
        namespace: opts.namespace,
        context: opts.context,
        includeSystem: opts.includeSystem,
      }

      if (opts.format !== 'json') {
        header('ChaosClaw Recon — Full Cluster Survey')
        field('Cluster Context', clusterContext)
        field('Namespace', opts.namespace)
      }

      // Always run init first to ensure the namespace exists
      const initEngine = new ReconInitEngine(kc)
      let initOk = true
      try {
        await initEngine.run(reconOptions)
        if (opts.format !== 'json') indent(`${chalk.green('[OK]')}   Namespace initialized`)
      } catch {
        if (opts.format !== 'json') indent(`${chalk.yellow('[WARN]')} Namespace init failed — continuing with existing namespace`)
        initOk = false
      }

      // Each entry: [tool name, engine instance]
      const tools: Array<[string, { run: (o: typeof reconOptions) => Promise<ReconToolResult> }]> = [
        ['webhooks', new WebhookReconEngine(kc)],
        ['policies', new PolicyReconEngine(kc)],
        ['psa', new PsaReconEngine(kc)],
        ['rbac', new RbacReconEngine(kc)],
        ['nodes', new NodeReconEngine(kc)],
        ['network-policies', new NetworkPolicyReconEngine(kc)],
        ['runtime-agents', new RuntimeAgentReconEngine(kc)],
        ['topology', new TopologyReconEngine()],
      ]

      const toolResults: ReconToolResult[] = []

      for (const [toolName, engine] of tools) {
        if (skipSet.has(toolName)) {
          if (opts.format !== 'json') indent(`${chalk.dim('[--]')}   ${toolName} — skipped`)
          continue
        }

        let result: ReconToolResult
        try {
          result = await engine.run(reconOptions)
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          result = { tool: toolName, status: 'error', findings: [], data: { error: msg } }
        }

        toolResults.push(result)

        if (opts.format !== 'json') {
          const notableFindings = result.findings.filter(f => f.severity !== 'SKIP' && f.severity !== 'INFO')
          const findingCount = notableFindings.length
          const badge = result.status === 'skip'
            ? chalk.yellow('[SKIP]')
            : result.status === 'error'
              ? chalk.red('[ERROR]')
              : worstSeverityBadge(result.findings)
          const summary = findingCount > 0 ? ` (${findingCount} finding${findingCount > 1 ? 's' : ''})` : ''
          indent(`${badge}   ${toolName}${summary}`)
        }
      }

      const endedAt = new Date().toISOString()
      const report = buildReport(clusterContext, opts.namespace, startedAt, endedAt, toolResults)

      if (opts.output) await writeJsonToFile(opts.output, report)

      if (opts.format === 'json') {
        console.log(JSON.stringify(report, null, 2))
        process.exit(0)
      }

      // Summary counts
      blank()
      section('Findings Summary')
      const s = report.summary
      const parts: string[] = []
      if (s.critical > 0) parts.push(chalk.red(`Critical: ${s.critical}`))
      if (s.high > 0) parts.push(chalk.red(`High: ${s.high}`))
      if (s.warn > 0) parts.push(chalk.yellow(`Warn: ${s.warn}`))
      if (s.info > 0) parts.push(chalk.dim(`Info: ${s.info}`))
      if (s.skip > 0) parts.push(chalk.yellow(`Skip: ${s.skip}`))
      indent(parts.length > 0 ? parts.join('    ') : 'No findings')

      // Highlight critical and high findings
      const notable = toolResults.flatMap(r => r.findings).filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH' || f.severity === 'WARN')
      if (notable.length > 0) {
        section('Notable Findings')
        for (const f of notable) {
          blank()
          indent(`${reconFindingLabel(f.severity)} ${f.title}`)
          indent(f.detail, 9)
        }
      }

      if (opts.output) {
        section('Artifacts')
        indent(`JSON report written to: ${opts.output}`)
      }

      if (!initOk) process.exit(1)
      process.exit(0)
    })
}

function worstSeverityBadge(findings: ReconFinding[]): string {
  if (findings.some(f => f.severity === 'CRITICAL')) return chalk.red('[CRITICAL]')
  if (findings.some(f => f.severity === 'HIGH'))     return chalk.red('[HIGH]')
  if (findings.some(f => f.severity === 'WARN'))     return chalk.yellow('[WARN]')
  return chalk.green('[OK]')
}

function buildReport(
  clusterContext: string,
  namespace: string,
  startedAt: string,
  endedAt: string,
  tools: ReconToolResult[],
): ReconReport {
  const summary = { critical: 0, high: 0, warn: 0, info: 0, skip: 0 }
  const severityKey: Record<ReconFindingSeverity, keyof typeof summary> = {
    CRITICAL: 'critical',
    HIGH: 'high',
    WARN: 'warn',
    INFO: 'info',
    SKIP: 'skip',
  }
  for (const tool of tools) {
    for (const finding of tool.findings) {
      summary[severityKey[finding.severity]]++
    }
  }
  return { runId: randomUUID(), clusterContext, namespace, startedAt, endedAt, summary, tools }
}
