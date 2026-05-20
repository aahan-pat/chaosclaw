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

## Run — Scenario Pack

```bash
chaosclaw verify run \
  --pack <preventive-baseline|runtime-baseline> \
  --context <context-name> \
  --output chaosclaw-result.json

# Runtime pack with a detection tool
chaosclaw verify run \
  --pack runtime-baseline \
  --alert-source <falco|tetragon|kubearmor|none> \
  --context <context-name> \
  --output chaosclaw-runtime.json
```

## Run — Single Scenario

```bash
chaosclaw verify run --scenario <scenario-id> --context <context-name>
```

## Run — Arbitrary Manifest

```bash
chaosclaw verify run \
  --manifest <path> \
  --expect <rejected|allowed> \
  --context <context-name>
```

## Exec — Binary Execution Inside a Pod

Submit a pod, exec a command, capture exit code + stdout + stderr.

```bash
chaosclaw verify exec \
  --pod <path> \
  --run "<command>" \
  --expect <succeeded|failed|denied> \
  --alert-source <falco|tetragon|kubearmor|none> \
  --context <context-name> \
  --output exec-result.json
```

| `--expect` | Meaning |
|---|---|
| `succeeded` | Exit code 0 |
| `failed` | Non-zero exit code |
| `denied` | Exec API blocked (403 — RBAC denies pods/exec) |

## Network — Reachability From Inside a Pod

```bash
chaosclaw verify network \
  --from <pod.yaml> \
  --target <url|host:port> \
  --expect <reachable|unreachable> \
  --alert-source <falco|tetragon|kubearmor|none> \
  --context <context-name> \
  --output network-result.json
```

Protocol is inferred from the target (`http://` → http, `https://` → https, `host:port` → tcp).

## Identity — RBAC Capability Test

Test what a service account is actually authorized to do. No pod created.

```bash
chaosclaw verify identity \
  --as <sa-name> \
  --can <verb> \
  --resource <resource> \
  --resource-namespace <ns> \
  --expect <allowed|denied> \
  --namespace <sa-namespace> \
  --context <context-name> \
  --output identity-result.json
```

Use slash notation for subresources: `--resource pods/exec`. Use `--group rbac.authorization.k8s.io` for RBAC resources. Requires `create subjectaccessreviews` permission — exit code 2 if denied.

## Detect — Runtime Detection Gap Test

Submit a pod, exec a threat command, poll the runtime tool for a correlated alert.

```bash
chaosclaw verify detect \
  --pod <path> \
  --run "<threat-command>" \
  --expect <alert_fired|action_blocked|no_alert> \
  --alert-source <falco|tetragon|kubearmor|none> \
  --observation-window <seconds> \
  --context <context-name> \
  --output detect-result.json
```

## Recon Commands

The `recon` group surveys the cluster's security posture. All tools are read-only.

### Initialize test namespace

```bash
chaosclaw recon init --context <context-name>
```

Creates the `chaosclaw` namespace, `ResourceQuota`, `ServiceAccount` `chaosclaw-runner`, and a namespace-scoped `Role`/`RoleBinding`. Idempotent.

### Full survey

```bash
chaosclaw recon all --context <context-name> --output recon.json
```

Options: `--skip <tools>` (comma-separated), `--include-system` (RBAC), `--format json`.

### Individual tools

```bash
chaosclaw recon webhooks          --context <ctx>
chaosclaw recon policies          --context <ctx>
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
| `CRITICAL` | Fundamental control absent |
| `HIGH` | Significant gap |
| `WARN` | Weakness that reduces defense depth |
| `INFO` | Informational observation |
| `SKIP` | Tool could not complete — insufficient permissions |

## Scenario Discovery

```bash
chaosclaw scenarios list
chaosclaw scenarios list --pack preventive-baseline
chaosclaw scenarios show <scenario-id>
```

## JSON Artifact Schema

All `verify` commands produce the same evidence envelope.

| Field | Description |
|---|---|
| `runId` | UUID for this run |
| `clusterContext` | Cluster that was tested |
| `summary` | `{ pass, fail, error, skipped }` counts |
| `results` | Per-result array |

Each result entry:

| Field | Description |
|---|---|
| `scenarioId` | e.g., `deny-privileged-container`, `exec:probe.yaml`, `identity:default/list/secrets` |
| `status` | `Pass`, `Fail`, `Error`, or `Skipped` |
| `expectedOutcome` | What was declared via `--expect` |
| `observedOutcome` | What actually happened |
| `likelyIssue` | Best-guess explanation for failures |
| `cleanupStatus` | `success`, `failed`, `skipped`, `partial` |
| `rawResponse` | JSON with tool-specific detail (exit code, stdout, HTTP status, alert payload) |

## Exit Codes

| Code | Meaning | Action |
|---|---|---|
| `0` | All checks passed | Confirm controls are verified |
| `1` | One or more failed | Summarize failures; suggest fixes |
| `2` | Execution error | Surface the error; do not treat as a control failure |
| `3` | Preflight failure | Resolve before rerunning |
| `4` | Invalid CLI usage | Check the command |

## Preventive Baseline Scenarios

| Scenario ID | Control Objective |
|---|---|
| `deny-privileged-container` | Prevent privileged workloads |
| `deny-unapproved-registry` | Restrict disallowed image registries |
| `deny-hostpath` | Prevent hostPath volume usage |
| `deny-forbidden-capabilities` | Restrict dangerous Linux capabilities |
| `deny-latest-tag` | Prevent mutable image tags |
| `deny-privilege-escalation` | Prevent privilege escalation |
| `deny-host-network` | Prevent host network namespace access |

## Remediation Reference

**`deny-privileged-container`** — Verify the policy covering `securityContext.privileged: true` is in `Enforce` mode (not `Audit`).

**`deny-unapproved-registry`** — Verify the allowlist covers all image pull paths including init containers.

**`deny-hostpath`** — Verify the policy covers bare `Pod` resources, not just `Deployment`.

**`deny-forbidden-capabilities`** — Check the blocklist includes both `NET_RAW` and `SYS_ADMIN`.

**`deny-latest-tag`** — Verify enforcement applies to all containers and is not scoped to a specific namespace.

**`deny-privilege-escalation`** — Confirm `allowPrivilegeEscalation: false` is enforced at admission, not just set as a default.

**`deny-host-network`** — Verify the policy covers `hostNetwork: true` on bare Pods, not just Deployments.
