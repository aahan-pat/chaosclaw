# CLI Reference

## Preflight

```bash
chaosclaw verify preflight --context <context-name>
```

| Outcome | Action |
|---|---|
| Pass | Proceed to run |
| Permission error | Show the missing permission; suggest an RBAC check; do not proceed |
| Missing policy engine warning | Note that some scenarios may be skipped; proceed |
| Any other failure | Do not proceed; surface the error |

## Run

```bash
chaosclaw verify run --pack preventive-baseline --context <context-name> --output chaosclaw-result.json
```

## Rerun (single scenario)

```bash
chaosclaw verify run --scenario <scenario-id> --context <context-name>
```

## Fleet run

```bash
chaosclaw verify run --pack preventive-baseline --context <context> --output results/<name>.json
```

## Scenario discovery

```bash
chaosclaw scenarios list
chaosclaw scenarios list --pack preventive-baseline
chaosclaw scenarios show <scenario-id>
```

## Recon commands

The `recon` group surveys the cluster's security posture. These are read-only — they do not submit workloads.

### Initialize test namespace

```bash
chaosclaw recon init --context <context-name>
```

Creates the `chaosclaw` namespace, `ResourceQuota` (pods: 10, cpu: 2, memory: 2Gi), `ServiceAccount` `chaosclaw-runner`, and a namespace-scoped `Role`/`RoleBinding`. Idempotent — safe to run on an existing namespace.

### Full survey

```bash
chaosclaw recon all --context <context-name> --output recon.json
```

Runs all seven tools sequentially. Options: `--skip <tools>` (comma-separated), `--include-system` (RBAC), `--format json`.

### Individual tools

```bash
chaosclaw recon webhooks          --context <ctx>
chaosclaw recon policies          --context <ctx> [--engine kyverno|gatekeeper|auto]
chaosclaw recon psa               --context <ctx>
chaosclaw recon rbac              --context <ctx> [--include-system]
chaosclaw recon nodes             --context <ctx>
chaosclaw recon network-policies  --context <ctx>
chaosclaw recon runtime-agents    --context <ctx>
```

All support `--output <file>` and `--format json`.

### Recon finding severities

| Severity | Meaning |
|---|---|
| `CRITICAL` | Fundamental control absent (e.g., no policy engine) |
| `HIGH` | Significant gap (e.g., fail-open webhook, no runtime agent, cluster-admin over-binding) |
| `WARN` | Weakness that reduces defense depth (e.g., Audit-mode policies, no egress policies) |
| `INFO` | Informational observation (e.g., kernel version outlier) |
| `SKIP` | Tool could not complete — insufficient permissions; see `coverageImpact` |

## JSON artifact schema

Top-level fields of `chaosclaw-result.json`:

| Field | Description |
|---|---|
| `runId` | UUID for this run |
| `clusterContext` | The cluster that was tested |
| `packId` | Scenario pack that ran |
| `summary` | `{ pass, fail, error, skipped }` counts |
| `results` | Per-scenario results array |

Each entry in `results`:

| Field | Description |
|---|---|
| `scenarioId` | e.g., `deny-privileged-container` |
| `status` | `Pass`, `Fail`, `Error`, or `Skipped` |
| `expectedOutcome` | What the cluster should have done |
| `observedOutcome` | What the cluster actually did |
| `likelyIssue` | Best-guess explanation for failures |
| `cleanupStatus` | Whether test resources were cleaned up |

## Exit codes

| Code | Meaning | Action |
|---|---|---|
| `0` | All scenarios passed | Confirm controls are verified |
| `1` | One or more scenarios failed | Summarize failures; suggest fixes |
| `2` | Execution error | Surface the error; do not treat as a control failure |
| `3` | Preflight failure | Resolve before rerunning |
| `4` | Invalid CLI usage | Check the command |

## Preventive baseline scenarios

| Scenario ID | Control Objective |
|---|---|
| `deny-privileged-container` | Prevent privileged workloads |
| `deny-unapproved-registry` | Restrict disallowed image registries |
| `deny-hostpath` | Prevent hostPath volume usage |
| `deny-forbidden-capabilities` | Restrict dangerous Linux capabilities |
| `deny-latest-tag` | Prevent mutable image tags |
| `deny-privilege-escalation` | Prevent privilege escalation |
| `deny-host-network` | Prevent host network namespace access |

## Remediation reference

Always confirm with the user before suggesting policy changes on production clusters.

**`deny-privileged-container`** — Verify the policy covering `securityContext.privileged: true` is installed and in `Enforce` mode (not `Audit`). For Kyverno: check the `disallow-privileged-containers` policy.

**`deny-unapproved-registry`** — Verify the allowlist policy covers all image pull paths including init containers. Confirm the test registry is not accidentally in the allowlist.

**`deny-hostpath`** — Verify the policy covers bare `Pod` resources, not just `Deployment`. Some policies restrict Deployments but miss bare Pods.

**`deny-forbidden-capabilities`** — Check the policy's capability blocklist includes both `NET_RAW` and `SYS_ADMIN` (or whatever capabilities the scenario uses). Some policies block one but not the other.

**`deny-latest-tag`** — Verify the policy applies to all containers including init containers, and is not scoped to a specific namespace.

**`deny-privilege-escalation`** — Confirm `allowPrivilegeEscalation: false` is enforced at admission, not just set as a default that workloads can override.

**`deny-host-network`** — Verify the policy covers `hostNetwork: true` on bare Pods, not just Deployments.
