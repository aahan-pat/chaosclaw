---
name: chaosclaw
description: Verify Kubernetes preventive controls using the ChaosClaw CLI — preflight checks, scenario pack runs, evidence parsing, and failure summarization for single-cluster or fleet-wide workflows.
metadata: {"openclaw": {"emoji": "⚔️", "requires": {"bins": ["chaosclaw", "kubectl"]}, "install": [{"id": "brew", "kind": "brew", "formula": "chaosclaw", "bins": ["chaosclaw"], "label": "Install ChaosClaw (brew)"}]}}
---

TRIGGER when: the user asks to verify Kubernetes controls, guardrails, admission policies, or Kyverno policies; asks to run ChaosClaw or a ChaosClaw scenario pack; asks to check whether a cluster's preventive controls are working; asks to investigate a failed control; or uses terms like "control verification", "preventive baseline", or "deny-*" scenario names.

SKIP: general Kubernetes debugging unrelated to admission controls or preventive policies; questions about ChaosClaw internals or source code.

---

# ChaosClaw Skill — Kubernetes Control Verification

This skill orchestrates ChaosClaw to verify that preventive Kubernetes guardrails actually work.

**Architecture rule:** ChaosClaw owns correctness (pass/fail semantics). This skill owns orchestration (workflow, context selection, summarization, remediation guidance). Never override or reinterpret ChaosClaw's PASS/FAIL/ERROR/SKIPPED verdicts.

---

## Core Workflow: `verify_cluster_baseline`

Use this workflow when the user wants to verify a single cluster.

### Step 1 — Resolve cluster context

Ask the user which Kubernetes context to use if not already known.

```bash
kubectl config get-contexts
```

Confirm the target context before proceeding. Never silently choose a context.

### Step 2 — Run preflight

```bash
chaosclaw verify preflight --context <context-name>
```

- If preflight passes: proceed to Step 3.
- If preflight fails with a permission error: show the specific missing permission and suggest the user check their RBAC profile. Do not proceed.
- If preflight warns about missing policy engine (e.g., Kyverno not installed): note that some scenarios may be skipped, then proceed.

### Step 3 — Run the baseline pack

```bash
chaosclaw verify run --pack preventive-baseline --context <context-name> --output chaosclaw-result.json
```

Wait for the run to complete and capture both terminal output and the JSON artifact.

### Step 4 — Parse results

Read `chaosclaw-result.json`. The top-level fields are:

| Field | Description |
|---|---|
| `runId` | UUID for this run |
| `clusterContext` | The cluster that was tested |
| `packId` | Scenario pack that ran |
| `summary` | `{ pass, fail, error, skipped }` counts |
| `results` | Per-scenario results (see below) |

Each entry in `results` has:

| Field | Description |
|---|---|
| `scenarioId` | e.g., `deny-privileged-container` |
| `status` | `Pass`, `Fail`, `Error`, or `Skipped` |
| `expectedOutcome` | What the cluster should have done |
| `observedOutcome` | What the cluster actually did |
| `likelyIssue` | Best-guess explanation for failures |
| `cleanupStatus` | Whether test resources were cleaned up |

### Step 5 — Summarize to the user

Present results using ChaosClaw's exact outcome vocabulary: **PASS**, **FAIL**, **ERROR**, **SKIPPED**.

For a clean run, confirm which controls are verified and working.

For failures, for each failed scenario:

1. State the scenario ID and control objective.
2. Quote the `likelyIssue` from the artifact.
3. Suggest a targeted remediation (see Remediation Reference below).
4. Offer to rerun just that scenario after the user applies a fix.

For errors, distinguish from failures: an `ERROR` means the scenario could not complete (timeout, auth issue, API failure) — it is not a verdict on the control.

For skipped scenarios, explain the missing prerequisite.

---

## Rerun Workflow: `rerun_failed_scenarios`

Use this after the user has applied a fix and wants to re-verify.

```bash
chaosclaw verify run --scenario <scenario-id> --context <context-name>
```

Compare the new result against the previous artifact. Report whether the control now passes.

---

## Fleet Workflow: `verify_prod_fleet`

Use when the user has a cluster inventory and wants to verify multiple clusters.

### Inventory format (`clusters.yaml`)

```yaml
clusters:
  - name: prod-us-east
    context: prod-us-east
    environment: prod
  - name: staging
    context: staging
    environment: staging
```

### Execution

For each cluster in the inventory, run Steps 2–4 of `verify_cluster_baseline`, writing output to a per-cluster artifact:

```bash
chaosclaw verify run --pack preventive-baseline --context <context> --output results/<name>.json
```

Run clusters sequentially unless the user explicitly requests parallel execution.

### Fleet aggregation

After all runs complete, aggregate:

- Total clusters: pass / fail / error counts
- Per-scenario: how many clusters failed each control
- Common failure patterns (scenarios that failed across multiple clusters)
- Rerun candidates (failed clusters)

Present a fleet summary table, then expand on the most common failures.

---

## Scenario Discovery

When the user asks what scenarios are available:

```bash
chaosclaw scenarios list
chaosclaw scenarios list --pack preventive-baseline
chaosclaw scenarios show <scenario-id>
```

---

## Preventive Baseline Scenarios

| Scenario ID | Control Objective |
|---|---|
| `deny-privileged-container` | Prevent privileged workloads |
| `deny-unapproved-registry` | Restrict disallowed image registries |
| `deny-hostpath` | Prevent hostPath volume usage |
| `deny-forbidden-capabilities` | Restrict dangerous Linux capabilities |
| `deny-latest-tag` | Prevent mutable image tags |
| `deny-privilege-escalation` | Prevent privilege escalation |

---

## Exit Code Reference

| Code | Meaning | Action |
|---|---|---|
| `0` | All scenarios passed | Confirm controls are verified |
| `1` | One or more scenarios failed | Summarize failures and suggest fixes |
| `2` | Execution error | Surface the error; do not interpret as a control failure |
| `3` | Preflight failure | Address the preflight issue before rerunning |
| `4` | Invalid CLI usage | Check the command; do not surface to user as a control result |

---

## Remediation Reference

Use these as starting points. Always confirm with the user before suggesting policy changes on production clusters.

**`deny-privileged-container`** — If failing: check whether the admission policy covering `securityContext.privileged: true` is installed and active. For Kyverno: verify the `disallow-privileged-containers` policy is in `Enforce` mode, not `Audit`.

**`deny-unapproved-registry`** — If failing: verify the allowlist policy is installed and that it covers all image pull paths (including init containers). Check that the registry in the test scenario is not accidentally in the allowlist.

**`deny-hostpath`** — If failing: verify the hostPath restriction policy covers the workload type used in the test. Some policies only restrict `Deployment` but not bare `Pod` resources.

**`deny-forbidden-capabilities`** — If failing: check whether the capability list in the policy matches the capabilities used in the scenario. Some policies block `NET_RAW` but not `SYS_ADMIN`.

**`deny-latest-tag`** — If failing: verify the policy is enforced for image tags and covers all containers (including init containers). Confirm the policy is not scoped to a specific namespace.

**`deny-privilege-escalation`** — If failing: check that `allowPrivilegeEscalation: false` is enforced at the admission level, not just set as a default.

---

## Safety Reminders

- ChaosClaw always runs in a dedicated test namespace (`chaosclaw-tests` by default). It does not touch application namespaces.
- Always confirm the cluster context before running. Never assume the current context is the intended target.
- If the user asks to skip preflight, decline and explain that preflight is a safety gate.
- If cleanup reports a partial failure, surface the `kubectl delete` command so the user can clean up manually.

---

## Output Artifacts

After every run, `chaosclaw-result.json` (or the user's chosen `--output` path) is the authoritative evidence artifact. Offer to save or display it. This artifact is the stable contract — do not modify or reinterpret it.
