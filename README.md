# ChaosClaw

ChaosClaw is a safe, namespace-scoped execution environment for Kubernetes security verification. It proves whether your Kubernetes guardrails actually work — not just whether they are configured — and serves as the controlled execution sandbox for OpenClaw-driven pentesting.

## What it does

ChaosClaw connects to a Kubernetes cluster and executes security verification tests inside a dedicated, RBAC-enforced test namespace. It cannot touch any other namespace in the cluster — this is enforced at the Kubernetes permission level, not just by convention.

Tests can be driven two ways:

- **Built-in scenario packs** — pre-built deterministic scenarios for common preventive controls (optional)
- **Arbitrary manifests** — supply any manifest via `--manifest` and declare the expected outcome; OpenClaw uses this to drive free-form pentesting without being constrained to pre-defined scenarios

Results are one of four outcomes: `PASS`, `FAIL`, `ERROR`, or `SKIPPED`. Every run produces a structured JSON artifact as evidence.

## Quick start

```bash
# Check that the cluster is ready
chaosclaw verify preflight

# Run the preventive baseline pack (optional built-in scenarios)
chaosclaw verify run --pack preventive-baseline

# Or supply any manifest directly (used by OpenClaw for free-form pentesting)
chaosclaw verify run --manifest ./my-pod.yaml --expect rejected
```

## Commands

### Cluster readiness

```bash
chaosclaw verify preflight
chaosclaw verify preflight --context prod-us-east
chaosclaw verify preflight --output json
```

### Run verification

```bash
# Built-in scenario packs (optional)
chaosclaw verify run --pack preventive-baseline
chaosclaw verify run --scenario deny-privileged-container
chaosclaw verify run --pack preventive-baseline --context prod-us-east
chaosclaw verify run --pack preventive-baseline --output result.json

# Arbitrary manifest (primary interface for OpenClaw)
chaosclaw verify run --manifest ./my-pod.yaml --expect rejected
chaosclaw verify run --manifest ./my-deployment.yaml --expect allowed
```

### Scenario discovery

```bash
chaosclaw scenarios list
chaosclaw scenarios list --pack preventive-baseline
chaosclaw scenarios show deny-privileged-container
```

### Other

```bash
chaosclaw version
chaosclaw help
```

## Flags

| Flag | Description |
|---|---|
| `--context <name>` | Kubernetes context to use |
| `--kubeconfig <path>` | kubeconfig path override |
| `--namespace <name>` | Test namespace override (default: `chaosclaw-tests`) |
| `--output <path>` | Write JSON evidence artifact to file |
| `--format <table\|json>` | Output mode |
| `--verbose` | Include extra diagnostic detail |
| `--quiet` | Minimal terminal output |
| `--no-color` | Disable colorized output |
| `--pack <id>` | Scenario pack to run |
| `--scenario <id>` | Single scenario to run |
| `--timeout <duration>` | Per-run timeout |
| `--fail-fast` | Stop after first failed scenario |
| `--cleanup <always\|on-success>` | Cleanup mode (default: `always`) |

## Scenarios

### Baseline pack: `preventive-baseline`

| Scenario | Control Objective |
|---|---|
| `deny-privileged-container` | Prevent privileged workloads |
| `deny-unapproved-registry` | Restrict disallowed image registries |
| `deny-hostpath` | Prevent hostPath volume usage |
| `deny-forbidden-capabilities` | Restrict dangerous Linux capabilities |
| `deny-latest-tag` | Prevent mutable image tags |

## Terminal output

### Preflight

```text
$ chaosclaw verify preflight --context prod-us-east

ChaosClaw Preflight
Cluster Context: prod-us-east
Test Namespace: chaosclaw-tests

Checks
  [PASS] Cluster reachable
  [PASS] Authentication valid
  [PASS] Namespace creation allowed
  [PASS] Pod create/delete permissions available
  [PASS] Cleanup permissions available
  [PASS] Baseline preventive scenarios supported

Result
  Preflight passed

Next
  chaosclaw verify run --pack preventive-baseline --context prod-us-east
```

### Verification run

```text
$ chaosclaw verify run --pack preventive-baseline --context prod-us-east --output result.json

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario Pack: preventive-baseline
Scenarios: 5
Test Namespace: chaosclaw-tests
Cleanup: always

Running Scenarios
  [PASS] deny-privileged-container
  [PASS] deny-unapproved-registry
  [FAIL] deny-hostpath
  [PASS] deny-forbidden-capabilities
  [PASS] deny-latest-tag

Summary
  Pass:    4
  Fail:    1
  Error:   0
  Skipped: 0

Failed Scenarios

  deny-hostpath
    Expected: admission rejected
    Observed: workload admitted
    Likely issue: hostPath restriction policy not enforced for this workload type

Artifacts
  JSON report written to: result.json

Exit Code
  1
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | All scenarios passed |
| `1` | One or more failed controls |
| `2` | Execution error |
| `3` | Preflight failure |
| `4` | Invalid CLI usage |

## JSON output

Every run can produce a structured evidence artifact. Use `--output <path>` to write it to a file, or `--format json` to print it to stdout.

```json
{
  "run_id": "uuid",
  "cluster_context": "prod-us-east",
  "pack_id": "preventive-baseline",
  "pack_version": "1",
  "started_at": "timestamp",
  "ended_at": "timestamp",
  "summary": {
    "pass": 4,
    "fail": 1,
    "error": 0,
    "skipped": 0
  },
  "results": [...]
}
```

## Safety model

ChaosClaw is designed to be safe to run in real clusters, including production.

- **RBAC-enforced namespace isolation** — ChaosClaw's service account is bound to the dedicated test namespace only; it structurally cannot read, write, or affect any other namespace
- All execution is confined to a dedicated test namespace (`chaosclaw-tests` by default)
- No user workloads or application namespaces are modified
- Cleanup always runs after every test, even on failure
- Tests run sequentially, not concurrently
- Every test has an execution timeout
- A `ResourceQuota` is applied to the test namespace to bound resource usage

## OpenClaw skills

ChaosClaw ships two OpenClaw skills in `skills/`:

| Skill | Trigger | Description |
|---|---|---|
| `chaosclaw` ⚔️ | "Verify controls on this cluster" | Targeted control verification — preflight, scenario pack runs, result parsing, failure summarization, fleet fan-out |
| `openclaw-pentest` 🔥 | "Pentest this cluster" | Autonomous security assessment — OpenClaw decides what to test and generates manifests freely; ChaosClaw executes each one safely in the scoped namespace and records outcomes. Produces a prioritized Critical/High/Gap report. |

Use `chaosclaw` when you know what you want to run. Use `openclaw-pentest` when you want OpenClaw to assess the cluster's security posture without being constrained to pre-defined scenarios.

### Register with OpenClaw

Add the skills directory to `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "load": {
      "extraDirs": ["/path/to/chaosclaw/skills"],
      "watch": true
    },
    "entries": {
      "chaosclaw": { "enabled": true },
      "openclaw-pentest": { "enabled": true }
    }
  }
}
```

### Skill structure

Each skill follows the orchestrator + references pattern:

```
skills/
  chaosclaw/
    SKILL.md                  ← workflows and safety rules
    references/
      goal-elaboration.md     ← result vocabulary, summarization, fleet aggregation
      cli-reference.md        ← commands, JSON schema, exit codes, remediation
  openclaw-pentest/
    SKILL.md                  ← pentest workflow and authorization gate
    references/
      goal-elaboration.md     ← scope, cross-pack correlation, severity, report structure
      cli-reference.md        ← commands, exit codes, scenario reference, remediation
```

ChaosClaw owns the pass/fail verdict. The skills own the workflow, interpretation, and remediation guidance layer.

---

## Architecture

ChaosClaw is a single-cluster CLI. Its primary role is as a **safe execution sandbox**: it enforces namespace isolation via RBAC, manages cleanup, records raw Kubernetes admission outcomes, and produces structured evidence. Scenario packs are optional built-ins.

OpenClaw is the optional orchestration and intelligence layer. It decides what to test — including generating manifests dynamically for free-form pentesting — and submits them to ChaosClaw for safe execution. ChaosClaw owns correctness and safety; OpenClaw owns what gets tested and what the results mean.

```
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
```

## Docs

- [Architecture](docs/architecture.md) — system design, multi-cluster model, and roadmap
- [CLI Design](docs/design.md) — UX principles, workflows, and command model
- [Screen Library](docs/cli-design.md) — canonical terminal output examples
- [Recon Layer Design](docs/recon-design.md) — reconnaissance command group, flag design, terminal output specs, and type contract
