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

The CLI must help users answer one core question:

> **Do my Kubernetes preventive guardrails actually work?**

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

The MVP should optimize for three workflows.

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
* `--timeout <duration>` — per-run timeout
* `--fail-fast` — stop after first failed scenario
* `--cleanup <always|on-success>` — cleanup mode, default `always`

### Recommendation

Support both `--pack` and `--scenario`, but require exactly one in MVP.

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

## 17. Immediate Next Design Artifacts

After this spec, the next design outputs should be:

### A. Command reference

A full command/flag table with examples.

### B. Terminal screen library

Canonical output examples for:

* success
* warning
* fail
* error
* skipped
* cleanup issue

### C. JSON schema

Formal schema for result artifacts.

### D. Scenario detail templates

Standard structure for built-in scenarios.

### E. Design partner walkthrough

A step-by-step scripted demo flow:

* preflight
* run baseline pack
* inspect failure
* rerun fixed scenario

```


