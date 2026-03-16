# ChaosClaw Architecture
## Single-Cluster MVP and Multi-Cluster Evolution with OpenClaw

**Version:** 0.1  
**Status:** Working architecture baseline  
**Audience:** Product, engineering, security architecture, design partners

---

## 1. Executive Summary

ChaosClaw should start as a **deterministic single-cluster CLI** for Kubernetes Continuous Control Verification.

The MVP should focus on one core job:

> **Prove that preventive Kubernetes guardrails actually work.**

That means the first version should:

- run against **one Kubernetes cluster at a time**
- execute a small set of **deterministic preventive-control scenarios**
- safely use a **scoped test namespace**
- capture **raw Kubernetes/admission outcomes**
- produce **pass / fail / error / skipped** results
- write **structured evidence** to JSON
- work **without** any control plane or agent runtime

OpenClaw comes in as the **optional orchestration layer**, not the verification engine.

Its role is to:

- coordinate runs across multiple clusters
- map skills to scenario packs
- summarize results
- drive re-test workflows
- add explanation and remediation guidance
- enable future closed-loop workflows

**Key design rule:**

> **ChaosClaw owns correctness. OpenClaw owns orchestration.**

---

## 2. Problem the Architecture Solves

ChaosClaw is intended to validate whether Kubernetes controls are effective in real environments, not just configured.

The architecture therefore needs to support:

- deterministic validation
- safe execution
- evidence generation
- future expansion from one cluster to many
- clean separation between product logic and agentic workflows

The architecture must avoid over-building in v1 while still creating a strong path to:

- multi-cluster verification
- scheduling
- change-triggered runs
- remediation guidance
- broader control verification workflows

---

## 3. Architecture Principles

### 3.1 Deterministic before agentic
Verification correctness cannot depend on autonomous reasoning.

ChaosClaw must be able to prove whether a control passed or failed using deterministic logic.

### 3.2 Single-cluster correctness is the foundation
Fleet-wide verification is only useful if one-cluster verification is reliable, safe, and repeatable.

### 3.3 Safety is a first-class requirement
All execution must be:

- namespace-scoped
- reversible
- least-privilege
- timeout-bound
- automatically cleaned up

### 3.4 Scenario definitions are declarative
Scenario definitions should be versioned and data-driven so the engine can grow without constantly changing core logic.

### 3.5 OpenClaw extends workflows; it does not redefine results
OpenClaw may invoke ChaosClaw, summarize outcomes, and recommend next steps, but it should not own pass/fail semantics.

### 3.6 Evidence must remain stable as the system scales
The JSON evidence schema created by the single-cluster CLI should remain the same foundation for later multi-cluster aggregation.

---

## 4. High-Level Architecture

### 4.1 Layered model

```text
+--------------------------------------------------------------+
|                   ChaosClaw Product Layer                    |
|--------------------------------------------------------------|
| CLI UX | Report formatting | Packaging | Scenario packs      |
+----------------------------+---------------------------------+
                             |
+----------------------------v---------------------------------+
|               ChaosClaw Verification Core                    |
|--------------------------------------------------------------|
| Scenario Registry | Preflight Checks | Executor              |
| Validation Engine | Evidence Builder | Cleanup Manager       |
+----------------------------+---------------------------------+
                             |
                     Kubernetes API / kubeconfig
                             |
+----------------------------v---------------------------------+
|                 Target Kubernetes Cluster                    |
|--------------------------------------------------------------|
| Admission controls | Kyverno / policies | test namespace     |
+--------------------------------------------------------------+

Optional post-MVP layer:

+--------------------------------------------------------------+
|                OpenClaw Agent Orchestration                  |
|--------------------------------------------------------------|
| Skills | Fleet workflows | Explanation | Remediation | Re-test|
+--------------------------------------------------------------+
````

### 4.2 Interpretation

* **ChaosClaw CLI core** is the product you ship first.
* **ChaosClaw verification core** is the source of truth for execution and validation.
* **OpenClaw** is added later as the orchestration plane for multi-cluster and workflow automation.

---

## 5. ChaosClaw Single-Cluster MVP

## 5.1 Product definition

The MVP is:

> **A CLI that connects to one Kubernetes cluster and runs preventive-control verification scenarios, then outputs structured evidence.**

This is intentionally narrow.

### In scope

* single cluster per run
* preventive controls only
* on-demand execution
* deterministic scenario outcomes
* terminal output
* JSON artifact output
* strict cleanup
* scoped test namespace
* direct use of kubeconfig / current context

### Out of scope

* web UI
* hosted control plane
* multi-cluster orchestration
* scheduling
* runtime detection validation
* remediation validation
* recovery validation
* ticketing / SIEM integration
* cluster scoring
* compliance reporting packages
* agent-required execution

---

## 5.2 Core components

### A. CLI command layer

Handles command parsing, flags, output formatting, and exit codes.

Example commands:

```bash
chaosclaw verify preflight
chaosclaw verify run --pack preventive-baseline
chaosclaw verify run --scenario deny-privileged-container
chaosclaw verify run --pack preventive-baseline --context prod-us-east --output result.json
chaosclaw scenarios list
chaosclaw scenarios show deny-hostpath
```

### B. Scenario registry

Loads built-in scenario definitions and scenario packs.

Responsibilities:

* resolve scenario IDs
* resolve pack membership
* load expected outcomes
* load cleanup metadata
* enforce versioned scenario schema

### C. Preflight engine

Validates that the target cluster is ready for execution.

Checks include:

* cluster reachable
* auth valid
* namespace creation allowed
* required permissions present
* policy prerequisites present
* target scenario pack supported

### D. Scenario executor

Applies the test manifest or action to the cluster and captures raw results.

Responsibilities:

* create or reuse test namespace
* apply manifest
* observe Kubernetes API response
* observe admission rejection or allow
* record execution timing
* inventory created resources

### E. Validation engine

Determines:

* `Pass`
* `Fail`
* `Error`
* `Skipped`

This is the most important deterministic layer in the system.

### F. Evidence builder

Creates:

* terminal summary
* per-scenario detail
* JSON evidence artifact

### G. Cleanup manager

Ensures:

* all created resources are deleted
* cleanup status is recorded
* cleanup happens even after failed scenarios where possible

---

## 5.3 MVP execution flow

```text
1. User runs ChaosClaw CLI.
2. CLI resolves kube context and selected scenario pack.
3. Preflight checks verify safety and prerequisites.
4. CLI creates scoped test namespace.
5. Scenarios execute sequentially.
6. Kubernetes admission allows or rejects each action.
7. ChaosClaw captures raw outcome.
8. Validation engine computes Pass / Fail / Error / Skipped.
9. Cleanup manager removes created artifacts.
10. Evidence builder writes JSON and terminal summary.
```

---

## 5.4 MVP baseline scenarios

Start with 5–7 deterministic preventive scenarios.

### Recommended first pack: `preventive-baseline`

1. **Privileged container denied**
2. **Unapproved registry denied**
3. **hostPath mount denied**
4. **Forbidden Linux capabilities denied**
5. **Latest tag denied**

Optional additions after hardening:

6. **Host network denied**
7. **Required labels enforced**

### Selection criteria

Every MVP scenario must be:

* deterministic
* safe to execute
* simple to clean up
* easy to explain
* directly tied to preventive guardrails
* valuable to platform and security teams

---

## 5.5 Scenario schema

Each scenario should be declarative and versioned.

Example:

```yaml
id: deny-privileged-container
version: 1
name: Privileged container denied
category: preventive
control_objective: Prevent privileged workloads
prerequisites:
  - can_create_pods
expected_outcome:
  type: admission_rejected
manifest_template: pod-privileged.yaml
cleanup:
  delete_created_resources: true
safety:
  level: low
  namespace_scoped: true
```

### Required fields

* `id`
* `version`
* `name`
* `description`
* `category`
* `control_objective`
* `prerequisites`
* `manifest_template`
* `expected_outcome`
* `cleanup`
* `safety`

---

## 5.6 Result model

ChaosClaw should use exactly four outcome types in MVP:

### Pass

The control behaved as expected.

Example:

* workload was rejected when it should have been rejected

### Fail

The control did not behave as expected.

Example:

* workload was admitted when it should have been blocked

### Error

The scenario could not complete reliably.

Example:

* timeout
* auth failure
* cluster API failure
* cleanup failure severe enough to invalidate the run

### Skipped

Scenario did not apply to the target cluster or prerequisites were missing.

Example:

* required policy engine not present
* required permission unavailable

---

## 5.7 Evidence schema

ChaosClaw should generate structured JSON that remains valid in both single-cluster and later fleet workflows.

### Run object

```json
{
  "run_id": "uuid",
  "cluster_context": "prod-us-east",
  "initiated_by": "local-user",
  "pack_id": "preventive-baseline",
  "pack_version": "1",
  "started_at": "timestamp",
  "ended_at": "timestamp",
  "summary": {
    "pass": 4,
    "fail": 1,
    "error": 0,
    "skipped": 0
  }
}
```

### Scenario result object

```json
{
  "scenario_id": "deny-privileged-container",
  "version": "1",
  "status": "Pass",
  "expected_outcome": "admission_rejected",
  "observed_outcome": "admission_rejected",
  "raw_response": "...",
  "manifest_snapshot": "...",
  "cleanup_status": "success",
  "started_at": "timestamp",
  "ended_at": "timestamp"
}
```

### Why this matters

This schema becomes the stable contract for:

* local CLI use
* OpenClaw skill parsing
* future aggregation
* future dashboards
* future compliance outputs

---

## 6. Safety Model

Safety is non-negotiable.

## 6.1 Safety controls

### Dedicated test namespace

All execution occurs in a dedicated ChaosClaw test namespace.

### Least-privilege access

The CLI should operate with only the permissions required for baseline scenarios.

### No mutation of customer workloads

MVP must not modify user workloads or application namespaces.

### Sequential execution

Run one scenario at a time in MVP.

### Timeouts

Each scenario has a maximum execution window.

### Cleanup guarantees

Cleanup should always be attempted, regardless of scenario result.

### Resource quotas

The test namespace should use conservative limits where possible.

### Auditability

Every run should record:

* cluster context
* selected scenarios
* timestamps
* manifest snapshot
* cleanup result
* raw API outcomes

---

## 7. OpenClaw Agent Layer

OpenClaw is **optional** in MVP and becomes important when the product expands to multi-cluster workflows.

## 7.1 Role of OpenClaw

OpenClaw should provide:

* orchestration
* skill-based invocation
* explanation
* workflow routing
* summarization
* fleet fan-out
* re-test flows

It should **not** provide:

* the core validation logic
* the source of truth for pass/fail
* direct ownership of scenario semantics

---

## 7.2 How skills map to verification

Use the following model:

### Scenario

A single deterministic test.

Examples:

* `deny-privileged-container`
* `deny-hostpath`
* `deny-unapproved-registry`

### Scenario pack

A curated group of related scenarios.

Examples:

* `preventive-baseline`
* `image-governance-pack`
* `rbac-hardening-pack`

### Skill

A workflow wrapper that uses ChaosClaw.

Examples:

* `verify_cluster_baseline`
* `verify_prod_fleet`
* `summarize_failed_controls`
* `rerun_failed_clusters`

### Mapping summary

| Entity        | Owned by  | Purpose                                      |
| ------------- | --------- | -------------------------------------------- |
| Scenario      | ChaosClaw | Defines one deterministic test               |
| Scenario Pack | ChaosClaw | Groups related scenarios                     |
| Skill         | OpenClaw  | Invokes ChaosClaw and adds workflow behavior |

---

## 7.3 Example OpenClaw skill behavior

### `verify_cluster_baseline`

```text
1. Read cluster context
2. Run chaosclaw verify preflight
3. Run chaosclaw verify run --pack preventive-baseline --output json
4. Parse the evidence artifact
5. Summarize failures
6. Recommend next steps
```

### `rerun_failed_clusters`

```text
1. Read prior fleet summary
2. Select failed cluster list
3. Re-run ChaosClaw only for impacted clusters
4. Compare old vs new evidence
5. Summarize improvement or remaining gaps
```

---

## 8. Multi-Cluster Architecture Using OpenClaw

## 8.1 Design rule

> **ChaosClaw remains single-cluster per execution. OpenClaw scales it horizontally across many clusters.**

This keeps the verification engine simple and reusable.

---

## 8.2 Multi-cluster logical architecture

```text
+---------------------------------------------------------------+
|                    OpenClaw Orchestrator                      |
|---------------------------------------------------------------|
| Fleet skill router | inventory | scheduling | summarization   |
+---------------------+--------------------+--------------------+
                      |                    |
          invokes ChaosClaw CLI     invokes ChaosClaw CLI
                      |                    |
             +--------v--------+  +--------v--------+
             | Cluster A run   |  | Cluster B run   |
             +-----------------+  +-----------------+
                      |                    |
                JSON evidence         JSON evidence
                      +--------+  +--------+
                               v  v
                    Fleet aggregation and follow-up
```

---

## 8.3 Recommended orchestration patterns

### Pattern A: Single orchestrator agent

One OpenClaw skill loops through the full target inventory.

**Best for:**

* earliest prototype
* small design-partner fleets
* simplest implementation

**Tradeoff:**

* less isolation between cluster runs

### Pattern B: One agent per cluster

Each OpenClaw agent owns one cluster context and workspace.

**Best for:**

* regulated environments
* higher isolation needs
* clear ownership boundaries

**Tradeoff:**

* more setup and lifecycle management

### Pattern C: One agent per environment group

One agent owns a group such as `prod`, `staging`, or `eu-west`.

**Best for:**

* medium-scale operations
* balance between isolation and operational simplicity

**Tradeoff:**

* some grouping-level shared state

### Recommendation

Start with:

> **Single orchestrator agent first**

Then move to:

> **One agent per cluster or environment group** as scale and isolation needs increase.

---

## 8.4 Fleet workflow

```text
1. User asks OpenClaw to verify a fleet.
2. OpenClaw resolves the target list.
3. OpenClaw selects the scenario pack and concurrency policy.
4. For each cluster, OpenClaw invokes ChaosClaw CLI with the correct context.
5. Each run produces an independent JSON artifact.
6. OpenClaw aggregates results.
7. OpenClaw highlights failed controls and patterns.
8. Optional remediation and re-test workflows begin.
```

---

## 8.5 Cluster inventory model

Open question, but likely options are:

### Option 1: Flat file inventory

Simple YAML/JSON file listing clusters and tags.

Pros:

* easy to start
* explicit
* portable

Cons:

* less dynamic

### Option 2: Workspace configuration

OpenClaw workspace holds environment definitions.

Pros:

* integrates naturally with skills
* easier for agent workflows

Cons:

* slightly more abstract

### Option 3: External source

Cluster list comes from an external system.

Pros:

* dynamic and enterprise-friendly

Cons:

* unnecessary for first implementation

### Recommendation

Start with a flat file.

Example:

```yaml
clusters:
  - name: prod-us-east
    context: prod-us-east
    environment: prod
    region: us-east
  - name: prod-us-west
    context: prod-us-west
    environment: prod
    region: us-west
  - name: staging
    context: staging
    environment: staging
    region: us-east
```

---

## 8.6 Aggregation model

OpenClaw should aggregate ChaosClaw outputs, not replace them.

### Per-cluster output remains:

* one ChaosClaw JSON artifact
* one deterministic result set
* one cluster-scoped source of truth

### Fleet summary adds:

* cluster pass/fail rollup
* failed control counts by scenario
* environment-level summaries
* common failure reasons
* rerun candidate list

This keeps aggregation downstream from the same core evidence model.

---

## 9. Ownership Boundaries

## 9.1 Owned by ChaosClaw

* scenario definitions
* scenario pack definitions
* CLI contract
* preflight logic
* execution logic
* validation semantics
* cleanup logic
* JSON evidence schema
* single-cluster safety guarantees

## 9.2 Owned by OpenClaw

* skill execution
* workflow routing
* cluster fan-out
* context isolation strategy
* scheduling later
* explanation
* remediation guidance
* re-test coordination
* fleet summarization

## 9.3 Shared contract

The stable interface between the two should be:

* CLI flags
* scenario IDs
* pack IDs
* exit codes
* JSON schema
* version compatibility rules

---

## 10. MVP vs Post-MVP

| Area           | MVP                    | Post-MVP                                                   |
| -------------- | ---------------------- | ---------------------------------------------------------- |
| Product form   | CLI only               | CLI + OpenClaw orchestration                               |
| Cluster scope  | Single cluster per run | Multi-cluster orchestration                                |
| Scenario scope | Preventive only        | Broader preventive, then detective and responsive          |
| Execution      | On-demand only         | Scheduled and change-triggered                             |
| Reporting      | Terminal + JSON        | Fleet summaries, dashboards, compliance outputs            |
| Automation     | None required          | Re-test loops, recommendations, closed-loop workflows      |
| Control plane  | None required          | Possible later central layer if enterprise needs demand it |

---

## 11. API / Interface Philosophy

Even if MVP is CLI-only, design the interface as if it will become a stable programmable contract.

### This means:

* clear flags
* clear exit codes
* versioned JSON schema
* predictable scenario IDs
* predictable pack IDs
* strong backward compatibility

### Suggested exit code model

* `0` = all scenarios passed
* `1` = one or more failed controls
* `2` = execution error
* `3` = preflight failure
* `4` = invalid CLI usage

This makes OpenClaw orchestration straightforward later.

---

## 12. Implementation Roadmap

## Phase 1 — ChaosClaw CLI core

Deliver:

* scenario registry
* preflight checks
* executor
* validation engine
* evidence builder
* cleanup manager
* 5 baseline preventive scenarios

Exit criteria:

* one cluster can be verified reliably
* pass/fail results are trustworthy
* JSON schema is stable enough for downstream automation

## Phase 2 — Hardening and packaging

Deliver:

* stronger cleanup behavior
* stable command model
* better output formatting
* more scenario coverage
* better docs and install flow

Exit criteria:

* design partners can use the CLI without engineering hand-holding

## Phase 3 — OpenClaw multi-cluster orchestration

Deliver:

* inventory-driven fleet skill
* fan-out execution
* fleet aggregation
* failed-cluster targeting
* rerun workflows

Exit criteria:

* multiple clusters can be verified using the same single-cluster core

## Phase 4 — Closed-loop workflows

Deliver:

* explanation skills
* remediation suggestions
* change-triggered re-verification
* richer operational workflows

Exit criteria:

* the product supports repeat operational use, not just one-time validation

---

## 13. Open Questions for Design Review

1. Should the initial branding be **ChaosClaw CLI**, **OpenClaw CLI**, or an open-core pairing?
2. What is the minimum stable evidence schema for both local and fleet use?
3. When, if ever, should the architecture move from kubeconfig-driven execution to an in-cluster runner?
4. What is the minimum RBAC profile needed for the baseline scenario pack?
5. Which scenarios require real admission attempts rather than dry-run?
6. What concurrency model should OpenClaw use for fleet verification?
7. At what point does the product need a central persistence layer beyond local JSON artifacts?

---

## 14. Recommendation

### Final recommendation

Ship **ChaosClaw first as a deterministic single-cluster CLI**.

Then use **OpenClaw as the orchestration layer** to expand the same engine into:

* multi-cluster verification
* skill-driven workflows
* fleet summaries
* remediation guidance
* re-test loops

### Architectural statement

> **ChaosClaw is the deterministic verification core for Continuous Control Verification. OpenClaw is the optional orchestration layer that scales ChaosClaw across clusters and workflows.**

This gives you the cleanest path to:

* fast MVP delivery
* trustworthy verification semantics
* low architectural risk
* future multi-cluster expansion
* a coherent product story

---

## 15. Implementation Language

**Decision:** ChaosClaw is implemented in **TypeScript (Node.js ≥ 22.16.0)**.

### Rationale

ChaosClaw and OpenClaw are sibling products. OpenClaw is a TypeScript-first monorepo. This alignment provides:

* **Shared JSON schema types** — The evidence schema can be a shared TypeScript package. No translation layer, no schema drift between the two products.
* **Skill integration** — OpenClaw skills are TypeScript. ChaosClaw can be imported directly by skills as a library, not only invoked as a subprocess.
* **Tooling alignment** — Same compiler (`tsc`/`tsdown`), test runner (`vitest`), linter (`oxlint`), and package manager (`pnpm`) as OpenClaw. Reduces toolchain fragmentation across the two products.
* **Kubernetes client** — `@kubernetes/client-node` is the official Kubernetes JavaScript/TypeScript client, maintained by the Kubernetes sig-api-machinery team.

### Distribution

ChaosClaw is bundled to a single distributable using `tsdown`, aligned with OpenClaw's build pipeline. A Docker image is provided for environments without a Node.js runtime.

### Tooling stack

| Tool | Purpose |
| --- | --- |
| TypeScript | Language |
| Node.js ≥ 22.16.0 | Runtime (aligned with OpenClaw) |
| `commander` | CLI argument parsing |
| `chalk` | Terminal color output |
| `@kubernetes/client-node` | Kubernetes API client |
| `tsdown` | Bundle to single distributable |
| `tsx` | Development runner |
| `vitest` | Test framework |
| `oxlint` | Linter |

```

This markdown is grounded in the current PRD’s MVP emphasis on **single-cluster execution, pass/fail reporting, and Kubernetes guardrail validation**, along with the proposal’s roadmap toward **multi-cluster orchestration**, **community/open scenario packs**, and later workflow automation. :contentReference[oaicite:0]{index=0} :contentReference[oaicite:1]{index=1} :contentReference[oaicite:2]{index=2}
```

