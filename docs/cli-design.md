# ChaosClaw CLI Terminal Screen Library
## MVP Canonical Output Examples

**Version:** 0.1  
**Status:** Working draft  
**Purpose:** Define the canonical terminal experience for ChaosClaw CLI MVP.

---

## 1. Why this exists

This screen library gives engineering and product a concrete reference for how the CLI should feel in practice.

It is intended to make these decisions explicit:

- what users see first
- how trust and safety are communicated
- how progress is shown
- how results are summarized
- how failures and warnings are explained
- what the CLI prints in normal vs verbose situations

This is not implementation code. It is the UX reference for terminal output.

---

## 2. Terminal UX principles

### 2.1 Always show target context
Every execution screen should clearly identify:

- cluster context
- scenario or pack
- test namespace

### 2.2 Keep the happy path compact
Successful runs should be readable in one screen without scrolling too much.

### 2.3 Expand only what matters
Show failure details by default. Keep passing scenarios brief.

### 2.4 Make safety visible
Always show:
- test namespace
- cleanup mode
- whether resources will be created

### 2.5 Use consistent status language
Use only:
- `PASS`
- `FAIL`
- `ERROR`
- `SKIPPED`
- `WARN`

### 2.6 Make next steps obvious
When there is a warning, failure, or error, the user should know what to do next.

---

## 3. Output conventions

## 3.1 Status formatting
Recommended plain-text style:

- `[PASS]`
- `[FAIL]`
- `[ERROR]`
- `[SKIPPED]`
- `[WARN]`

If color is available:
- PASS = green
- FAIL = red
- ERROR = red
- SKIPPED = yellow
- WARN = yellow

Output must still work cleanly without color.

---

## 3.2 Section order for commands

Recommended order:

1. command purpose header
2. target context
3. safety context
4. progress/results
5. summary
6. details
7. artifacts
8. next steps
9. exit code where helpful

---

## 3.3 Terminology rules

Use:
- **Cluster Context**
- **Scenario Pack**
- **Scenario**
- **Test Namespace**
- **Cleanup**
- **Summary**
- **Artifacts**
- **Next**

Do not use inconsistent alternatives like:
- target env
- profile
- workspace
- report bundle

---

## 4. Screen: `verify preflight` success

### Purpose
Show that the cluster is reachable and safe enough to run.

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
````

### Notes

* this is the preferred happy-path preflight screen
* it is short and confidence-building
* the next action is explicit

---

## 5. Screen: `verify preflight` passed with warnings

### Purpose

Warn the user that the run may not be complete, without blocking them.

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

### Notes

* warnings should not feel like hard errors
* a warning should describe reduced coverage, not generic uncertainty

---

## 6. Screen: `verify preflight` hard failure

### Purpose

Stop the user before unsafe or impossible execution.

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

### Notes

* failure reason should be specific
* next steps should be practical
* do not dump stack traces here

---

## 7. Screen: `scenarios list`

### Purpose

Help users discover built-in scenarios and packs.

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

### Notes

* keep list compact
* show one-line purpose, not deep detail

---

## 8. Screen: `scenarios show`

### Purpose

Let the user inspect what a scenario actually does.

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

### Notes

* this should read like a compact fact sheet
* avoid huge manifest dumps in default mode

---

## 9. Screen: `verify run` happy path, all pass

### Purpose

Show the ideal baseline run.

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

### Notes

* this is the core “success” screen for demos
* no extra noise needed
* no need to print exit code on full success

---

## 10. Screen: `verify run` with one failed control

### Purpose

Show a realistic and useful result.

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

### Notes

* failed scenarios expand automatically
* likely issue should be a short hint, not a long diagnosis
* this is probably the most important screen in the MVP

---

## 11. Screen: `verify run` with skipped scenarios

### Purpose

Show reduced coverage clearly.

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

### Notes

* skipped is not pass
* skipped should have clear reasons
* this is important for trust and auditability

---

## 12. Screen: `verify run` with execution error

### Purpose

Separate system/execution problems from control failures.

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

### Notes

* errors should feel operational, not semantic
* give the user one concrete next action

---

## 13. Screen: `verify run` with cleanup warning

### Purpose

Make cleanup issues visible without making the whole run unreadable.

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

### Notes

* this should not be buried
* cleanup warnings must be visible because trust depends on them

---

## 14. Screen: `verify run` single scenario rerun success

### Purpose

Support fast validation after a policy fix.

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

### Notes

* rerun screens should feel lightweight
* the user should not need to scroll through unnecessary context

---

## 15. Screen: `verify run` with `--fail-fast`

### Purpose

Make it clear why execution stopped early.

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

### Notes

* “Not Run” matters here
* the early stop should be explicit

---

## 16. Screen: invalid command usage

### Purpose

Keep CLI mistakes easy to recover from.

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

### Notes

* this is much better than a generic parser error
* usage messages should teach, not just complain

---

## 17. Screen: wrong or missing cluster context

### Purpose

Avoid accidental execution in the wrong place.

```text
$ chaosclaw verify run --pack preventive-baseline --context prod-eu

Error
  Kubernetes context not found: prod-eu

Next
  - Run kubectl config get-contexts
  - Choose a valid context
  - Re-run with --context <name>
```

### Notes

* cluster identity is safety-critical
* keep this message sharp and specific

---

## 18. Screen: namespace override acknowledged

### Purpose

Show that an override was honored.

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

### Notes

* namespace visibility matters because it is part of the trust model

---

## 19. Screen: verbose mode

### Purpose

Allow extra detail without overwhelming default users.

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

### Notes

* verbose mode should add value, not noise
* good for support, engineering, and design partner debugging

---

## 20. Screen: JSON-only output mode

### Purpose

Support automation while keeping terminal noise low.

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

### Notes

* this mode is useful for scripts
* default human-readable mode should still remain the main UX

---

## 21. Screen: command help

### Purpose

Show concise command help.

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

### Notes

* help must be compact enough to scan
* examples matter more than long prose

---

## 22. Screen inventory summary

These are the canonical screens that should exist for MVP:

1. preflight success
2. preflight success with warnings
3. preflight hard failure
4. scenarios list
5. scenarios show
6. run success all pass
7. run with failed scenarios
8. run with skipped scenarios
9. run with execution error
10. run with cleanup warning
11. rerun single scenario success
12. fail-fast early stop
13. invalid usage
14. missing context
15. namespace override
16. verbose mode
17. json-only output
18. command help

---


