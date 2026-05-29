# ChaosClaw CLI Design Spec
## MVP UX and Interaction Design

**Version:** 0.1  
**Status:** Working draft  
**Audience:** Product, design, engineering

---

## 1. Purpose

This document defines the user experience and interaction model for the ChaosClaw CLI MVP.

The goal is to make ChaosClaw feel:

- safe
- trustworthy
- operator-friendly
- deterministic
- fast to understand
- easy to rerun after changes

ChaosClaw serves two audiences with one command surface:

- **Human operators** answering: *Do my Kubernetes preventive guardrails actually work?*
- **OpenClaw** using ChaosClaw as a safe execution sandbox: *Run this manifest against the cluster and tell me what happened.*

The CLI must make both paths clear and the safety model visible in both.

---

## 2. Design Goals

### 2.1 Primary goal
Enable a user to verify preventive Kubernetes controls on a single cluster with minimal setup and high confidence in the result.

### 2.2 UX goals

The CLI should be:

- **clear** — users should understand what is being tested
- **safe** — users should know the blast radius is limited
- **predictable** — commands and outputs should be consistent
- **actionable** — failures should point to the likely control gap
- **fast** — the common path should take only a few commands
- **scriptable** — output and exit codes must support automation

### 2.3 Non-goals

The MVP CLI does not need to be:

- conversational
- highly customizable
- visually dense
- a replacement for dashboards
- a full policy authoring tool

---

## 3. Target Users

### 3.1 Primary user
Cloud Security Engineer or Platform Security Engineer

### 3.2 Secondary user
Platform engineer responsible for validating policy changes

### 3.3 User mindset
The user is not browsing casually. They are usually trying to:

- validate controls after a policy rollout
- verify a new cluster
- confirm a regression did not occur
- investigate why a risky workload was not blocked

They want confidence, not exploration.

---

## 4. Core UX Principles

### 4.1 Show what is being tested
Before or during execution, the CLI should make the scope visible:
- which cluster
- which scenario pack
- which scenarios
- where execution happens

### 4.2 Never hide safety context
The CLI should clearly state:
- which namespace it will use
- whether it will create resources
- whether cleanup will occur automatically

### 4.3 Make failures easy to understand
For every failed scenario, the CLI should show:
- expected behavior
- actual behavior
- likely reason
- where to inspect more detail

### 4.4 Keep the happy path short
A first useful run should look like:

```bash
chaosclaw verify preflight
chaosclaw verify run --pack preventive-baseline
````

### 4.5 Default to operator trust

Avoid flashy output. Prefer structured, readable, stable output.

### 4.6 Design for rerun

The CLI should assume users will re-run after fixing a policy. Rerun flows should be simple.

---

## 5. Primary Workflows

The MVP should optimize for four workflows.

### Workflow 1: Preflight a cluster

**User intent:**
Before I run verification, tell me whether this cluster is ready and whether ChaosClaw can safely execute.

**Success condition:**
The user sees whether the cluster is reachable, supported, and safe to test.

### Workflow 2: Run the preventive baseline pack

**User intent:**
Run the standard preventive control checks and tell me what passed or failed.

**Success condition:**
The user gets a clear summary and can inspect failures.

### Workflow 3: Investigate and rerun a failed scenario

**User intent:**
I fixed a policy or suspect a gap. I want to rerun a scenario or pack and compare results.

**Success condition:**
The user can target a scenario or rerun the same pack with minimal friction.

### Workflow 4: Execute an arbitrary manifest (OpenClaw-driven)

**User intent (OpenClaw):**
I've generated a manifest that tests a specific attack vector. Execute it safely and tell me whether it was admitted or rejected.

**Success condition:**
ChaosClaw executes the manifest in the RBAC-scoped test namespace, records the raw outcome against the declared expectation, and returns a structured result. OpenClaw can call this repeatedly with different manifests to conduct free-form pentesting without being constrained to pre-defined scenarios.

---

## 6. Command Model

## 6.1 Top-level command groups

Recommended structure:

```bash
chaosclaw verify ...
chaosclaw scenarios ...
chaosclaw version
chaosclaw help
```

### Why this structure

* `verify` contains operational execution commands
* `scenarios` contains discovery and inspection commands
* keeps the MVP surface small
* leaves room for future groups later

---

## 6.2 Proposed commands

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
chaosclaw verify run --manifest ./my-pod.yaml --expect rejected
chaosclaw verify run --manifest ./my-pod.yaml --expect allowed
```

### Scenario discovery

```bash
chaosclaw scenarios list
chaosclaw scenarios list --pack preventive-baseline
chaosclaw scenarios show deny-privileged-container
```

### Future-friendly but post-MVP

```bash
chaosclaw verify rerun --from result.json
chaosclaw verify run --only-failed result.json
```

These can be deferred if needed.

---

## 6.3 Key flags

### Common flags

* `--context <name>` — Kubernetes context to use
* `--kubeconfig <path>` — kubeconfig override
* `--namespace <name>` — test namespace override
* `--output <path>` — write JSON result artifact
* `--format <table|json>` — output mode
* `--verbose` — include more diagnostic detail
* `--quiet` — minimal terminal output
* `--no-color` — disable colorized output

### Run-specific flags

* `--pack <id>` — scenario pack to run
* `--scenario <id>` — single scenario to run
* `--manifest <path>` — path to a user-supplied Pod manifest (YAML or JSON) to test directly
* `--expect <rejected|allowed>` — expected admission outcome when using `--manifest`
* `--timeout <duration>` — per-run timeout
* `--fail-fast` — stop after first failed scenario
* `--cleanup <always|on-success>` — cleanup mode, default `always`

### Recommendation

Require exactly one of `--pack`, `--scenario`, or `--manifest` per run.

---

## 7. Information Architecture of Output

Each run should communicate information in this order:

1. **Target**
2. **Scope**
3. **Safety context**
4. **Progress**
5. **Summary**
6. **Failure details**
7. **Artifact location**

This ordering is important because users want to quickly answer:

* Am I on the right cluster?
* What is this going to do?
* Did it work?

---

## 8. Workflow 1: Preflight UX

## 8.1 Purpose

Preflight should tell the user whether ChaosClaw can safely and successfully run against the target cluster.

## 8.2 What preflight checks

* Kubernetes context resolved
* cluster reachable
* user authenticated
* required API access available
* namespace creation allowed
* cleanup-capable permissions present
* pack/scenario prerequisites met
* policy prerequisites detected where needed

## 8.3 Terminal output example

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
  [WARN] Some scenarios may be skipped if Kyverno policies are not installed

Result
  Preflight passed with warnings

Next
  Run: chaosclaw verify run --pack preventive-baseline --context prod-us-east
```

## 8.4 UX guidance

* preflight should feel reassuring, not verbose
* warnings should not look like failures
* preflight should suggest the next command

---

## 9. Workflow 2: Run baseline pack UX

## 9.1 Purpose

Run a known pack and quickly show what passed or failed.

## 9.2 Output stages

### Stage A: Run header

Show:

* cluster context
* namespace
* pack
* number of scenarios
* cleanup behavior

### Stage B: Scenario progress

Show each scenario as it executes.

### Stage C: Summary

Show pass/fail/error/skipped counts.

### Stage D: Failure details

Expand only failed/error scenarios by default.

### Stage E: Artifact location

Show where JSON output was written.

---

## 9.3 Run output example

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
    Likely issue: hostPath restriction policy not enforced for this resource type

Artifacts
  JSON report written to: result.json

Exit Code
  1
```

---

## 10. Workflow 3: Investigate and rerun UX

## 10.1 Purpose

After a failure, the user should be able to inspect a scenario and rerun it with minimal effort.

## 10.2 Scenario inspection example

```text
$ chaosclaw scenarios show deny-hostpath

Scenario: deny-hostpath
Category: preventive
Control Objective: Prevent hostPath volume usage
Expected Outcome: admission rejected
Risk Level: low
Pack Membership:
  - preventive-baseline

Description
  Attempts to create a pod using a hostPath volume. The cluster should reject it.

Prerequisites
  - pod create permissions
  - admission policy covering hostPath usage
```

## 10.3 Rerun example

```text
$ chaosclaw verify run --scenario deny-hostpath --context prod-us-east

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario: deny-hostpath
Test Namespace: chaosclaw-tests
Cleanup: always

Running Scenario
  [PASS] deny-hostpath

Summary
  Pass:    1
  Fail:    0
  Error:   0
  Skipped: 0
```

## 10.4 UX guidance

* rerunning one scenario should feel lightweight
* users should not need to remember pack contents to rerun a specific failed check

---

## 11. Output Design

## 11.1 Terminal output modes

### Default mode

Human-readable text with compact structure.

### JSON mode

Machine-readable result output.

### Recommendation

Use default human-readable output for terminal and always allow JSON artifact output via `--output`.

---

## 11.2 Output style rules

* use short labels
* prefer aligned summaries
* do not dump raw JSON to terminal by default
* do not print large manifest blobs unless `--verbose`
* show detailed raw response only for failures/errors or verbose mode

---

## 11.3 Status vocabulary

Use only:

* `PASS`
* `FAIL`
* `ERROR`
* `SKIPPED`

These should appear consistently in:

* terminal output
* JSON output
* logs
* documentation

---

## 12. Error-State Design

## 12.1 Principles

Errors should be:

* specific
* actionable
* non-alarming unless safety is at risk
* clearly separated from failed scenarios

## 12.2 Common error classes

### Preflight error

Example:

* cluster unreachable
* auth invalid
* required permissions missing

### Execution error

Example:

* timeout
* API request failed
* namespace creation failed

### Validation ambiguity

Example:

* response could not be interpreted deterministically

### Cleanup error

Example:

* test resources could not be deleted

---

## 12.3 Error example

```text
$ chaosclaw verify run --pack preventive-baseline

Error
  Could not create test namespace: chaosclaw-tests

Reason
  User does not have permission to create namespaces in the current context

Next
  - Run chaosclaw verify preflight
  - Use a context with namespace create/delete permissions
  - Or specify an existing approved test namespace with --namespace
```

## 12.4 Cleanup warning example

```text
Warning
  Cleanup incomplete for scenario deny-hostpath

Details
  Pod chaosclaw-test-abc123 could not be deleted automatically

Next
  kubectl delete pod chaosclaw-test-abc123 -n chaosclaw-tests
```

---

## 13. JSON Artifact Design

## 13.1 Design goals

The JSON report should be:

* stable
* easy to parse
* expressive enough for later OpenClaw use
* cluster-scoped
* pack/scenario version aware

## 13.2 Recommended top-level fields

* `run_id`
* `cluster_context`
* `pack_id` or `scenario_id`
* `started_at`
* `ended_at`
* `summary`
* `results`
* `tool_version`

## 13.3 Recommendation

Treat this JSON as a stable contract from day one. It will later feed:

* OpenClaw skills
* multi-cluster aggregation
* rerun workflows
* dashboards

---

## 14. UX for Trust and Safety

This product will be judged heavily on trust.

### The CLI should always make clear:

* what it is about to do
* where it is doing it
* what resources it may create
* that cleanup is automatic
* whether any cleanup failed

### The CLI should never:

* silently choose the wrong cluster
* silently skip scenarios without saying so
* bury failures in verbose logs
* hide safety-relevant warnings

---

## 15. MVP vs Post-MVP UX

## MVP

* CLI only
* single cluster
* on-demand
* built-in scenario packs
* terminal summary
* JSON output
* manual rerun

## Post-MVP

* rerun from previous result
* compare old vs new runs
* OpenClaw skill integration
* fleet summaries
* scheduled runs
* change-triggered verification
* richer remediation guidance

---

## 16. Design Decisions to Lock Now

1. **Top-level structure**

   * `verify`
   * `scenarios`

2. **One primary pack**

   * `preventive-baseline`

3. **One outcome vocabulary**

   * pass / fail / error / skipped

4. **One output contract**

   * human-readable terminal + stable JSON artifact

5. **One trust model**

   * explicit cluster, explicit namespace, explicit cleanup

---

## 17. Screen Library

This section is the canonical reference for ChaosClaw CLI terminal output. Every screen listed here should be implemented exactly as shown for MVP.

### Output conventions

**Status labels** — use `[PASS]`, `[FAIL]`, `[ERROR]`, `[SKIPPED]`, `[WARN]`. With color: green for PASS, red for FAIL/ERROR, yellow for SKIPPED/WARN. Output must remain clean without color.

**Terminology** — use exactly these terms, never alternatives like "target env", "profile", or "workspace":

| Term | Do not substitute |
| ---- | ----------------- |
| Cluster Context | target env, environment |
| Scenario Pack | profile, suite |
| Test Namespace | workspace, test env |
| Cleanup | teardown |
| Summary | results |
| Artifacts | report bundle |
| Next | instructions |

**Section order within a screen:**
1. command purpose header
2. target context
3. safety context
4. progress / results
5. summary
6. details
7. artifacts
8. next steps
9. exit code where helpful

---

### Screen: `verify preflight` — success

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

*Short and confidence-building. The next action is explicit.*

---

### Screen: `verify preflight` — with warnings

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
  [WARN] Some scenarios may be skipped because no hostPath policy was detected

Result
  Preflight passed with warnings

Next
  chaosclaw verify run --pack preventive-baseline --context prod-us-east
```

*Warnings should not look like hard errors. A warning describes reduced coverage, not generic uncertainty.*

---

### Screen: `verify preflight` — hard failure

```text
$ chaosclaw verify preflight --context prod-us-east

ChaosClaw Preflight
Cluster Context: prod-us-east
Test Namespace: chaosclaw-tests

Checks
  [PASS] Cluster reachable
  [PASS] Authentication valid
  [FAIL] Namespace creation not allowed

Result
  Preflight failed

Reason
  Current credentials cannot create namespaces in this cluster context

Next
  - Use a context with namespace create/delete permissions
  - Or specify an approved existing test namespace with --namespace
  - Re-run: chaosclaw verify preflight --context prod-us-east --namespace <name>
```

*Failure reason must be specific. Next steps must be practical. No stack traces.*

---

### Screen: `scenarios list`

```text
$ chaosclaw scenarios list

Available Scenario Packs
  preventive-baseline   6 scenarios   Core preventive guardrail checks

Available Scenarios
  deny-privileged-container      Prevent privileged workloads
  deny-unapproved-registry       Restrict disallowed image registries
  deny-hostpath                  Prevent hostPath volume usage
  deny-forbidden-capabilities    Restrict dangerous Linux capabilities
  deny-latest-tag                Prevent mutable image tags
  deny-privilege-escalation      Prevent container privilege escalation
```

*Keep list compact. Show one-line purpose, not deep detail.*

---

### Screen: `scenarios show`

```text
$ chaosclaw scenarios show deny-hostpath

Scenario: deny-hostpath
Version: 1
Category: preventive
Control Objective: Prevent hostPath volume usage
Expected Outcome: admission rejected
Risk Level: low

Description
  Attempts to create a pod using a hostPath volume. The cluster should reject it.

Prerequisites
  - pod create permissions
  - admission policy covering hostPath usage

Pack Membership
  - preventive-baseline
```

*Reads like a compact fact sheet. No manifest dumps in default mode.*

---

### Screen: `verify run` — all pass

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
  [PASS] deny-hostpath
  [PASS] deny-forbidden-capabilities
  [PASS] deny-latest-tag

Summary
  Pass:    5
  Fail:    0
  Error:   0
  Skipped: 0

Artifacts
  JSON report written to: result.json
```

*The core "success" screen for demos. No extra noise. No exit code needed on full success.*

---

### Screen: `verify run` — with failed scenario

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

*Failed scenarios expand automatically. Likely issue is a short hint, not a long diagnosis. This is the most important screen in the MVP.*

---

### Screen: `verify run` — with skipped scenarios

```text
$ chaosclaw verify run --pack preventive-baseline --context staging --output result.json

ChaosClaw Verification Run
Cluster Context: staging
Scenario Pack: preventive-baseline
Scenarios: 5
Test Namespace: chaosclaw-tests
Cleanup: always

Running Scenarios
  [PASS] deny-privileged-container
  [PASS] deny-unapproved-registry
  [SKIPPED] deny-hostpath
  [PASS] deny-forbidden-capabilities
  [PASS] deny-latest-tag

Summary
  Pass:    4
  Fail:    0
  Error:   0
  Skipped: 1

Skipped Scenarios

  deny-hostpath
    Reason: no applicable hostPath admission policy detected

Artifacts
  JSON report written to: result.json
```

*SKIPPED is not PASS. Skipped scenarios always include a reason — this matters for trust and auditability.*

---

### Screen: `verify run` — execution error

```text
$ chaosclaw verify run --pack preventive-baseline --context prod-us-east

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario Pack: preventive-baseline
Scenarios: 5
Test Namespace: chaosclaw-tests
Cleanup: always

Running Scenarios
  [PASS] deny-privileged-container
  [ERROR] deny-unapproved-registry

Summary
  Pass:    1
  Fail:    0
  Error:   1
  Skipped: 0

Errors

  deny-unapproved-registry
    Reason: request timed out while waiting for Kubernetes API response
    Action: rerun the scenario or verify API server responsiveness

Next
  chaosclaw verify run --scenario deny-unapproved-registry --context prod-us-east
```

*Errors feel operational, not semantic. Give the user one concrete next action.*

---

### Screen: `verify run` — cleanup warning

```text
$ chaosclaw verify run --scenario deny-hostpath --context prod-us-east

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario: deny-hostpath
Test Namespace: chaosclaw-tests
Cleanup: always

Running Scenario
  [PASS] deny-hostpath

Summary
  Pass:    1
  Fail:    0
  Error:   0
  Skipped: 0

[WARN] Cleanup incomplete

Details
  Pod chaosclaw-test-abc123 could not be deleted automatically

Next
  kubectl delete pod chaosclaw-test-abc123 -n chaosclaw-tests
```

*Cleanup warnings must be visible. Trust depends on them.*

---

### Screen: `verify run` — single scenario rerun

```text
$ chaosclaw verify run --scenario deny-hostpath --context prod-us-east

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario: deny-hostpath
Test Namespace: chaosclaw-tests
Cleanup: always

Running Scenario
  [PASS] deny-hostpath

Summary
  Pass:    1
  Fail:    0
  Error:   0
  Skipped: 0
```

*Rerun screens are lightweight. Users should not need to scroll through unnecessary context.*

---

### Screen: `verify run` — `--fail-fast`

```text
$ chaosclaw verify run --pack preventive-baseline --context prod-us-east --fail-fast

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario Pack: preventive-baseline
Scenarios: 5
Test Namespace: chaosclaw-tests
Cleanup: always
Mode: fail-fast

Running Scenarios
  [PASS] deny-privileged-container
  [FAIL] deny-unapproved-registry

Summary
  Pass:    1
  Fail:    1
  Error:   0
  Skipped: 0
  Not Run: 3

Stopped Early
  Execution stopped after first failed scenario because --fail-fast was enabled
```

*"Not Run" count matters. Early stop must be explicit.*

---

### Screen: invalid command usage

```text
$ chaosclaw verify run

Error
  Missing required target: specify exactly one of --pack, --scenario, or --manifest

Examples
  chaosclaw verify run --pack preventive-baseline
  chaosclaw verify run --scenario deny-hostpath
  chaosclaw verify run --manifest ./my-pod.yaml --expect rejected

Help
  chaosclaw verify run --help
```

*Usage messages should teach, not just complain.*

---

### Screen: wrong or missing cluster context

```text
$ chaosclaw verify run --pack preventive-baseline --context prod-eu

Error
  Kubernetes context not found: prod-eu

Next
  - Run kubectl config get-contexts
  - Choose a valid context
  - Re-run with --context <name>
```

*Cluster identity is safety-critical. Keep this message sharp and specific.*

---

### Screen: namespace override acknowledged

```text
$ chaosclaw verify run --pack preventive-baseline --context prod-us-east --namespace security-test-ns

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario Pack: preventive-baseline
Scenarios: 5
Test Namespace: security-test-ns
Cleanup: always

Running Scenarios
  [PASS] deny-privileged-container
  [PASS] deny-unapproved-registry
  [PASS] deny-hostpath
  [PASS] deny-forbidden-capabilities
  [PASS] deny-latest-tag

Summary
  Pass:    5
  Fail:    0
  Error:   0
  Skipped: 0
```

*Namespace visibility matters — it is part of the trust model.*

---

### Screen: verbose mode

```text
$ chaosclaw verify run --scenario deny-hostpath --context prod-us-east --verbose

ChaosClaw Verification Run
Cluster Context: prod-us-east
Scenario: deny-hostpath
Test Namespace: chaosclaw-tests
Cleanup: always

Scenario Details
  Description: Attempts to create a pod using a hostPath volume
  Expected Outcome: admission rejected
  Manifest Template: pod-hostpath.yaml

Execution
  Creating test namespace if needed
  Applying manifest
  Kubernetes API response: forbidden
  Admission reason: hostPath volumes are not allowed by policy

Running Scenario
  [PASS] deny-hostpath

Summary
  Pass:    1
  Fail:    0
  Error:   0
  Skipped: 0
```

*Verbose mode adds value, not noise. Good for debugging and design-partner sessions.*

---

### Screen: JSON output mode

```text
$ chaosclaw verify run --pack preventive-baseline --format json

{
  "run_id": "7b4f...",
  "cluster_context": "prod-us-east",
  "pack_id": "preventive-baseline",
  "started_at": "2026-03-15T10:15:00Z",
  "ended_at": "2026-03-15T10:16:10Z",
  "summary": {
    "pass": 4,
    "fail": 1,
    "error": 0,
    "skipped": 0
  },
  "results": [
    ...
  ]
}
```

*This mode is useful for scripts and OpenClaw skill invocation. Human-readable mode remains the default.*

---

### Screen: command help

```text
$ chaosclaw verify run --help

Usage
  chaosclaw verify run (--pack <id> | --scenario <id> | --manifest <path> --expect <outcome>) [flags]

Flags
  --pack <id>            scenario pack to run
  --scenario <id>        single scenario to run
  --manifest <path>      path to a Pod manifest file (YAML or JSON) to test directly
  --expect <outcome>     expected admission outcome when using --manifest: rejected or allowed
  --context <name>       Kubernetes context to use
  --kubeconfig <path>    kubeconfig path override
  --namespace <name>     test namespace override
  --output <path>        write JSON report to file
  --format <mode>        output mode: table, json
  --timeout <ms>         per-scenario timeout in milliseconds
  --fail-fast            stop after first failure
  --cleanup <mode>       cleanup mode: always, on-success
  --verbose              include extra diagnostics

Examples
  chaosclaw verify run --pack preventive-baseline
  chaosclaw verify run --scenario deny-hostpath --context prod-us-east
  chaosclaw verify run --manifest ./my-pod.yaml --expect rejected
```

*Help text must be compact enough to scan. Examples matter more than long prose.*

---

### Screen inventory

These are the canonical screens required for MVP:

1. preflight — success
2. preflight — with warnings
3. preflight — hard failure
4. scenarios list
5. scenarios show
6. verify run — all pass
7. verify run — with failed scenario
8. verify run — with skipped scenarios
9. verify run — execution error
10. verify run — cleanup warning
11. verify run — single scenario rerun
12. verify run — `--fail-fast`
13. invalid command usage
14. wrong or missing cluster context
15. namespace override acknowledged
16. verbose mode
17. JSON output mode
18. command help


