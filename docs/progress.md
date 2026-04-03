# ChaosClaw MVP Progress

**Last updated:** 2026-04-03

---

## Phase 1 — ChaosClaw CLI Core

> **Goal:** One cluster can be verified reliably. Pass/fail results are trustworthy. JSON schema is stable enough for downstream automation.

### Design and architecture

- [x] Architecture document (`docs/architecture.md`)
- [x] CLI UX design spec (`docs/design.md`)
- [x] Terminal screen library (`docs/cli-design.md`)
- [x] Language decision documented (TypeScript, aligned with OpenClaw)

### Project scaffold

- [x] `package.json` with full dependency set
- [x] `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`
- [x] `.gitignore`
- [x] Typechecks clean

### Core types

- [x] `src/types/scenario.ts` — scenario and pack schema
- [x] `src/types/evidence.ts` — run result and JSON evidence schema

### Verification core

- [x] `src/core/registry.ts` — scenario registry
- [x] `src/core/preflight.ts` — preflight engine (cluster reachability, auth, namespace, pod, cleanup permissions)
- [x] `src/core/executor.ts` — scenario executor (applies manifests, captures admission outcome)
- [x] `src/core/validator.ts` — validation engine (deterministic Pass/Fail/Error/Skipped)
- [x] `src/core/cleanup.ts` — cleanup manager (deletes created resources, tracks partial failures)
- [x] `src/core/evidence-builder.ts` — JSON evidence artifact builder

### Scenarios

- [x] `deny-privileged-container`
- [x] `deny-unapproved-registry`
- [x] `deny-hostpath`
- [x] `deny-forbidden-capabilities`
- [x] `deny-latest-tag`
- [x] `deny-privilege-escalation`

### CLI commands

- [x] `chaosclaw verify preflight`
- [x] `chaosclaw verify run --pack <id>`
- [x] `chaosclaw verify run --scenario <id>`
- [x] `chaosclaw verify run --manifest <path> --expect <rejected|allowed>`
- [x] `chaosclaw scenarios list`
- [x] `chaosclaw scenarios show <id>`

### Tests

- [ ] Unit tests for validation engine
- [ ] Unit tests for registry
- [ ] Unit tests for evidence builder
- [ ] Unit tests for scenario definitions
- [ ] Integration tests for preflight (against a real or fake cluster)
- [ ] Integration tests for run (against a real or fake cluster)

### Build and distribution

- [ ] `npm run build` produces working `dist/index.js`
- [ ] Binary is executable (`chmod +x` / shebang works)
- [ ] Smoke test: `chaosclaw --help` works from dist
- [ ] Smoke test: `chaosclaw scenarios list` works from dist

### Namespace management

- [x] Auto-create test namespace if it does not exist
- [x] Skip namespace creation if namespace already exists (409 ignored)
- [ ] Namespace cleanup after run (optional, off by default)

### Exit criteria

- [ ] One cluster verified end-to-end with real admission policies
- [ ] Pass/fail results match expected cluster behavior
- [ ] JSON artifact is written and parseable
- [ ] Cleanup leaves no test resources behind

---

## Phase 2 — Hardening and Packaging

> **Goal:** Design partners can use the CLI without engineering hand-holding.

- [ ] Stronger cleanup: retry on transient delete failures
- [ ] Cleanup report in every JSON artifact
- [ ] `chaosclaw verify run --only-failed <result.json>` rerun workflow
- [ ] `chaosclaw verify run --from <result.json>` rerun from prior run
- [ ] Scenario prerequisite checking (skip with reason if prereq not met)
- [ ] Richer failure diagnosis messages per scenario
- [ ] RBAC profile documentation (minimum permissions for baseline pack)
- [ ] Install instructions (npm global, Homebrew, Docker)
- [ ] `CHANGELOG.md`
- [ ] Expanded scenario coverage (host network, required labels)
- [ ] `chaosclaw version` includes build metadata

---

## Phase 3 — OpenClaw Multi-Cluster Orchestration

> **Goal:** Multiple clusters can be verified using the same single-cluster core.

### ChaosClaw MCP Server

- [ ] `chaosclaw_preflight` — run connectivity/permission checks, return structured result
- [ ] `chaosclaw_run_scenario` — run a single scenario by ID, return evidence
- [ ] `chaosclaw_run_pack` — run a full pack, return summary + per-scenario outcomes
- [ ] `chaosclaw_list_scenarios` — return the scenario catalog (for the LLM to reason about)
- [ ] `chaosclaw_get_evidence` — fetch a specific artifact by run ID
- [ ] Evidence responses include compact `summary` field; full detail via `get_evidence` (bounded context)
- [ ] MCP server exposes ChaosClaw as a structured tool, not a subprocess

### Fleet orchestration

- [ ] Flat file cluster inventory format (`clusters.yaml`)
- [ ] OpenClaw skill: `verify_cluster_baseline`
- [ ] OpenClaw skill: `verify_prod_fleet` (fan-out across inventory)
- [ ] OpenClaw skill: `rerun_failed_clusters`
- [ ] Fleet aggregation schema (rolls up per-cluster JSON artifacts)
- [ ] Fleet summary output (pass/fail rollup by cluster and scenario)
- [ ] Failed-cluster targeting workflow

---

## Phase 4 — Closed-Loop Workflows

> **Goal:** The product supports repeat operational use, not just one-time validation.

- [ ] OpenClaw skill: `summarize_failed_controls` (LLM explanation of failures)
- [ ] OpenClaw skill: remediation suggestion per failed scenario
- [ ] Change-triggered re-verification (webhook or CI hook)
- [ ] Run comparison (old vs new evidence artifact diff)
- [ ] Richer operational workflows and scheduling
