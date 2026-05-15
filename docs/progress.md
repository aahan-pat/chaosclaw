# ChaosClaw MVP Progress

**Last updated:** 2026-05-15

---

## Phase 1 — ChaosClaw CLI Core

> **Goal:** One cluster can be verified reliably. Pass/fail results are trustworthy. JSON schema is stable enough for downstream automation.

### Design and architecture

- [x] Architecture document (`docs/architecture.md`)
- [x] CLI UX design spec (`docs/design.md`)
- [x] Terminal screen library (`docs/cli-design.md`)
- [x] Recon layer design spec (`docs/recon-design.md`)
- [x] Language decision documented (TypeScript, aligned with OpenClaw)
- [x] Safety model updated: RBAC-enforced namespace isolation as primary safety boundary

### Project scaffold

- [x] `package.json` with full dependency set
- [x] `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`
- [x] `.gitignore`
- [x] Typechecks clean

### Core types

- [x] `src/types/scenario.ts` — scenario and pack schema
- [x] `src/types/evidence.ts` — run result and JSON evidence schema
- [x] `src/types/recon.ts` — `ReconFinding`, `ReconToolResult`, `ReconReport`, `ReconOptions`

### Verification core

- [x] `src/core/registry.ts` — scenario registry
- [x] `src/core/preflight.ts` — preflight engine (cluster reachability, auth, namespace, pod, cleanup permissions)
- [x] `src/core/executor.ts` — scenario executor (applies manifests, captures admission outcome)
- [x] `src/core/validator.ts` — validation engine (deterministic Pass/Fail/Error/Skipped)
- [x] `src/core/cleanup.ts` — cleanup manager (deletes created resources, tracks partial failures)
- [x] `src/core/evidence-builder.ts` — JSON evidence artifact builder

### Scenarios — Preventive Baseline

- [x] `deny-privileged-container`
- [x] `deny-unapproved-registry`
- [x] `deny-hostpath`
- [x] `deny-forbidden-capabilities`
- [x] `deny-latest-tag`
- [x] `deny-privilege-escalation`
- [x] `deny-host-network`

### CLI commands — Verify

- [x] `chaosclaw verify preflight`
- [x] `chaosclaw verify run --pack <id>`
- [x] `chaosclaw verify run --scenario <id>`
- [x] `chaosclaw verify run --manifest <path> --expect <rejected|allowed>`
- [x] `chaosclaw scenarios list`
- [x] `chaosclaw scenarios show <id>`

### Runtime detection

- [x] `src/core/runtime-executor.ts` — `RuntimeScenarioExecutor`, `RuntimeAlertSource` interface, `RuntimeAlert`, `RuntimeObservedOutcome`, `RuntimeExecutionResult`
- [x] `src/core/runtime-validator.ts` — validates alert-based outcomes (alert_fired, action_blocked, no_alert)
- [x] `src/core/alert-sources/null.ts` — `NullAlertSource` (no-op, for pipeline testing without a real tool)
- [x] Runtime scenarios registered in `src/scenarios/runtime-baseline/` — `detect-read-sensitive-file`
- [x] Runtime executor wired to CLI — `verify run --pack runtime-baseline --alert-source none`
- [x] `scenarios list` and `scenarios show` updated to display runtime scenarios
- [ ] `RuntimeAlertSource` adapter: Falco (HTTP/gRPC)
- [ ] `RuntimeAlertSource` adapter: Tetragon (gRPC)
- [ ] `RuntimeAlertSource` adapter: KubeArmor (gRPC)
- [ ] Runtime preflight checks (detect which runtime tools are present on the cluster)

### Namespace management

- [x] Auto-create test namespace if it does not exist
- [x] Skip namespace creation if namespace already exists (409 ignored)
- [x] `ResourceQuota` applied via `recon init` (pods: 10, cpu: 2/4, memory: 2Gi/4Gi) — closes #4
- [ ] Namespace cleanup after run (optional, off by default)

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

### Exit criteria

- [ ] One cluster verified end-to-end with real admission policies
- [ ] Pass/fail results match expected cluster behavior
- [ ] JSON artifact is written and parseable
- [ ] Cleanup leaves no test resources behind

---

## Recon Layer — Complete

> **Status: Shipped.** OpenClaw is using these commands to drive pentesting decisions.

The reconnaissance layer surveys a cluster's security posture before any test workloads are submitted. All tools are read-only. A single tool failure never aborts the survey.

### Types and output helpers

- [x] `src/types/recon.ts` — `ReconFindingSeverity`, `ReconFinding`, `ReconToolResult`, `ReconReport`, `ReconOptions`
- [x] `src/cli/output.ts` — `reconFindingLabel()`, `renderReconFindings()`

### Recon engines

- [x] `src/core/recon/init.ts` — `ReconInitEngine`: namespace, ResourceQuota, ServiceAccount, Role, RoleBinding (all idempotent)
- [x] `src/core/recon/webhooks.ts` — `WebhookReconEngine`: fail-open webhook detection (HIGH)
- [x] `src/core/recon/policies.ts` — `PolicyReconEngine`: Kyverno/Gatekeeper probe, audit-mode detection
- [x] `src/core/recon/psa.ts` — `PsaReconEngine`: pod-security label survey across namespaces
- [x] `src/core/recon/rbac.ts` — `RbacReconEngine`: cluster-admin bindings, high-privilege service accounts
- [x] `src/core/recon/nodes.ts` — `NodeReconEngine`: kernel version, container runtime, AppArmor presence
- [x] `src/core/recon/network-policies.ts` — `NetworkPolicyReconEngine`: per-namespace gap detection
- [x] `src/core/recon/runtime-agents.ts` — `RuntimeAgentReconEngine`: Falco, KubeArmor, Tetragon, Tracee detection

### CLI commands — Recon

- [x] `chaosclaw recon init` — initialize test namespace with RBAC scoping and ResourceQuota
- [x] `chaosclaw recon webhooks` — survey admission webhooks
- [x] `chaosclaw recon policies` — detect policy engine and enforcement mode
- [x] `chaosclaw recon psa` — survey Pod Security Admission labels
- [x] `chaosclaw recon rbac` — survey RBAC posture
- [x] `chaosclaw recon nodes` — survey node kernel versions and runtimes
- [x] `chaosclaw recon network-policies` — survey network segmentation per namespace
- [x] `chaosclaw recon runtime-agents` — detect runtime security agents
- [x] `chaosclaw recon all` — run all tools sequentially, assemble `ReconReport`, write to `--output`

### Output and schema

- [x] `ReconReport` JSON schema: `runId`, `clusterContext`, `namespace`, `startedAt`, `endedAt`, `summary`, `tools[]`
- [x] Per-tool `data` shapes documented and stable (used by OpenClaw for decision-making)
- [x] Badge severity in `recon all` reflects worst finding (`[CRITICAL]`/`[HIGH]`/`[WARN]`/`[OK]`)
- [x] 403 → SKIP handling: each engine catches `ApiException.code === 403` internally; survey never aborts

### OpenClaw skills

- [x] `skills/openclaw-pentest/SKILL.md` — recon-first pentest workflow (8 steps)
- [x] `skills/openclaw-pentest/references/cli-reference.md` — full recon command reference, `ReconReport` schema, tool data shapes, `--manifest` execution path
- [x] `skills/openclaw-pentest/references/goal-elaboration.md` — per-tool interpretation tables, custom manifest strategy, 3-layer correlation
- [x] `skills/chaosclaw/SKILL.md` — `recon init` added to verify workflow
- [x] `skills/chaosclaw/references/cli-reference.md` — recon commands and finding severity table added

---

## Phase 2 — Execution Layer for OpenClaw Pentesting

> **Goal:** OpenClaw can drive free-form pentesting via manifest submission, with enough scenario coverage and runtime adapters to produce meaningful security assessments.

### Scenario coverage

- [ ] `deny-required-labels` — label enforcement scenario (closes #2)
- [ ] Additional runtime scenarios (exec-based attack surface coverage)
- [ ] Traceability labels on all test resources — `app.kubernetes.io/managed-by`, `chaosclaw/run-id`, `chaosclaw/scenario-id` (closes #3)

### Runtime alert source adapters

- [ ] `RuntimeAlertSource` adapter: Falco (HTTP/gRPC)
- [ ] `RuntimeAlertSource` adapter: Tetragon (gRPC)
- [ ] `RuntimeAlertSource` adapter: KubeArmor (gRPC)
- [ ] Runtime preflight check: auto-detect which runtime agent is present and configure alert source accordingly

### Preflight improvements

- [ ] Scenario prerequisite enumeration at preflight time — list which scenarios will SKIP before the run starts (closes #8)
- [ ] Richer failure diagnosis messages per scenario

### Hardening

- [ ] Stronger cleanup: retry on transient delete failures
- [ ] Cleanup report included in every JSON artifact
- [ ] `chaosclaw verify run --only-failed <result.json>` rerun workflow
- [ ] `chaosclaw verify run --from <result.json>` rerun from prior run
- [ ] RBAC profile documentation (minimum permissions for each pack)
- [ ] `chaosclaw version` includes build metadata

### Build and distribution

- [ ] `npm run build` produces working `dist/index.js`
- [ ] Binary is executable from dist (closes #9)
- [ ] Install instructions (npm global, Homebrew, Docker)
- [ ] `CHANGELOG.md`

---

## Phase 3 — OpenClaw Multi-Cluster Orchestration

> **Goal:** Multiple clusters can be verified using the same single-cluster core.

### ChaosClaw MCP Server

- [ ] `chaosclaw_preflight` — run connectivity/permission checks, return structured result
- [ ] `chaosclaw_run_scenario` — run a single scenario by ID, return evidence
- [ ] `chaosclaw_run_pack` — run a full pack, return summary + per-scenario outcomes
- [ ] `chaosclaw_recon_all` — run recon survey, return `ReconReport`
- [ ] `chaosclaw_list_scenarios` — return the scenario catalog
- [ ] `chaosclaw_get_evidence` — fetch a specific artifact by run ID

### Fleet orchestration

- [ ] Flat file cluster inventory format (`clusters.yaml`)
- [ ] OpenClaw skill: `verify_prod_fleet` (fan-out across inventory)
- [ ] OpenClaw skill: `rerun_failed_clusters`
- [ ] Fleet aggregation schema (rolls up per-cluster JSON artifacts)
- [ ] Fleet summary output (pass/fail rollup by cluster and scenario)

---

## Phase 4 — Closed-Loop Workflows

> **Goal:** The product supports repeat operational use, not just one-time validation.

- [ ] OpenClaw skill: `summarize_failed_controls` (LLM explanation of failures)
- [ ] OpenClaw skill: remediation suggestion per failed scenario
- [ ] Change-triggered re-verification (webhook or CI hook)
- [ ] Run comparison (old vs new evidence artifact diff)
- [ ] Richer operational workflows and scheduling
