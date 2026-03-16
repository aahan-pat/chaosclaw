# ChaosClaw

ChaosClaw is a deterministic CLI for Kubernetes Continuous Control Verification. It proves whether your preventive Kubernetes guardrails actually work — not just whether they are configured.

## What it does

ChaosClaw connects to a Kubernetes cluster and runs preventive-control verification scenarios. Each scenario attempts a specific action that your policies should block, then reports whether the cluster behaved as expected.

Results are one of four outcomes: `PASS`, `FAIL`, `ERROR`, or `SKIPPED`. Every run produces a structured JSON artifact as evidence.

## Quick start

```bash
# Check that the cluster is ready
chaosclaw verify preflight

# Run the preventive baseline pack
chaosclaw verify run --pack preventive-baseline
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
chaosclaw verify run --pack preventive-baseline
chaosclaw verify run --scenario deny-privileged-container
chaosclaw verify run --pack preventive-baseline --context prod-us-east
chaosclaw verify run --pack preventive-baseline --output result.json
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

ChaosClaw is designed to be safe to run in real clusters.

- All execution is confined to a dedicated test namespace (`chaosclaw-tests` by default)
- No user workloads or application namespaces are modified
- Cleanup always runs after every scenario, even on failure
- Scenarios run sequentially, not concurrently
- Every scenario has an execution timeout
- The CLI requires only the minimum permissions needed for the selected scenarios

## Architecture

ChaosClaw is a single-cluster CLI. It owns scenario definitions, preflight checks, execution, validation semantics, cleanup, and the JSON evidence schema.

Multi-cluster orchestration is handled by **OpenClaw**, an optional agent layer that invokes ChaosClaw across a fleet, aggregates results, and supports remediation and re-test workflows. ChaosClaw owns correctness; OpenClaw owns orchestration.

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
