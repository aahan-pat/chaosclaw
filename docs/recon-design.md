# ChaosClaw Reconnaissance Layer Design

**Status:** Design complete — not yet implemented
**Audience:** Engineering

---

## 1. Purpose

The reconnaissance layer gives ChaosClaw (and OpenClaw) a read-only survey of a cluster's security posture before any test manifests are submitted. It answers the question: *what is actually enforced on this cluster, and where are the gaps?*

Recon serves two consumers:

- **Human operators** — run it before a verification pass to understand what to expect
- **OpenClaw pentest skill** — runs it automatically to shape which manifests to generate for free-form pentesting

Recon is strictly read-only. It never submits test workloads, modifies cluster state, or touches application namespaces. The one exception is `recon init`, which creates and configures the `chaosclaw` test namespace.

---

## 2. Command Group

```
chaosclaw recon init               ← namespace + RBAC setup (required entry point)
chaosclaw recon webhooks           ← admission webhook survey
chaosclaw recon policies           ← Kyverno / Gatekeeper / PSA detection
chaosclaw recon psa                ← pod security admission labels per namespace
chaosclaw recon rbac               ← cluster roles and high-privilege service accounts
chaosclaw recon nodes              ← node kernel, runtime, seccomp/AppArmor posture
chaosclaw recon network-policies   ← namespace network segmentation coverage
chaosclaw recon runtime-agents     ← Falco, KubeArmor, Tetragon detection
chaosclaw recon all                ← runs all of the above in sequence
```

`recon init` must be run before any pentest activity. All other recon commands are independent and can be run in any order.

---

## 3. Namespace Model

The recon layer initializes and operates within a dedicated namespace named **`chaosclaw`**. This is distinct from any application or production namespace.

`recon init` creates:
- The `chaosclaw` namespace
- A `ResourceQuota` to bound resource usage
- A `ServiceAccount` (`chaosclaw-runner`) scoped to that namespace
- A `Role` and `RoleBinding` that limit the service account to the `chaosclaw` namespace only

All subsequent pentest execution (scenario runs, manifest submission) uses this namespace. The RBAC binding enforces that ChaosClaw structurally cannot affect any other namespace — this is the primary safety guarantee, not a convention.

The namespace name can be overridden with `--namespace <name>` on `recon init`. All other commands inherit the namespace from their `--namespace` flag (default: `chaosclaw`).

---

## 4. Flag Design

ChaosClaw makes direct API calls via `@kubernetes/client-node` — it does not shell out to `kubectl`. The flag surface is exactly what ChaosClaw exposes. That is the restrictiveness boundary.

### Allowed — promote info gathering

| Flag | Applies to | Purpose |
|---|---|---|
| `--context <name>` | all | Target Kubernetes context |
| `--namespace <name>` | `init`, scoped reads | Override the default `chaosclaw` namespace |
| `--format <table\|json>` | all | Output mode |
| `--output <path>` | all | Write JSON result artifact to file |
| `--verbose` | all | Show full rule/spec detail rather than summaries |
| `--engine <kyverno\|gatekeeper\|auto>` | `policies` only | Skip auto-detection, target a specific engine |
| `--include-system` | `rbac` only | Include `kube-system` service accounts (off by default — noisy) |
| `--skip <tool,...>` | `all` only | Skip specific recon steps |

### Blocked

| What | Why |
|---|---|
| `--watch` / `--follow` | Recon is point-in-time; persistent connections have no place in a survey |
| `--label-selector` / `--field-selector` passthrough | Scope is ChaosClaw's to decide, not the caller's |
| Any mutation flag | All recon is strictly read-only at the API level |
| Arbitrary kubectl argument passthrough | ChaosClaw calls the API directly; there is no kubectl |

---

## 5. Finding Vocabulary

Recon findings use a severity vocabulary that is intentionally separate from the scenario outcome vocabulary (`PASS / FAIL / ERROR / SKIPPED`). Recon findings feed OpenClaw for analysis, not the JSON evidence schema.

| Severity | Meaning |
|---|---|
| `CRITICAL` | A gap that represents a complete failure of a control layer |
| `HIGH` | A significant misconfiguration or missing control with real attack surface |
| `WARN` | A notable finding that warrants attention but does not represent an outright gap |
| `INFO` | An observation worth recording but not a finding |
| `SKIP` | A recon step could not complete due to insufficient RBAC — results are partial |

A `SKIP` is never a silent failure. It always surfaces what permission was missing and what coverage was lost as a result.

---

## 6. Error Handling

Three tiers:

**Soft finding** — something was queried successfully but what was found is a security concern. Surfaced as an inline `[WARN]`, `[HIGH]`, or `[CRITICAL]` in the Findings section. Does not stop execution.

**Partial skip** — RBAC prevented reading a resource type. Surfaced as `[SKIP]` with the missing permission and the coverage impact. Execution continues with reduced coverage.

**Hard error** — cluster unreachable, auth invalid, or namespace creation failed. Exits non-zero with a specific reason and a next step.

---

## 7. Command Designs

### 7.1 `chaosclaw recon init`

Creates the `chaosclaw` namespace and applies RBAC scoping. Idempotent — safe to run multiple times.

**Success:**

```
$ chaosclaw recon init --context prod-us-east

ChaosClaw Recon — Namespace Init
Cluster Context: prod-us-east
Namespace: chaosclaw

  [OK] Namespace chaosclaw created
  [OK] ResourceQuota applied (pods: 10, cpu: 2, memory: 2Gi)
  [OK] ServiceAccount chaosclaw-runner created
  [OK] Role and RoleBinding scoped to chaosclaw namespace

Ready
  All pentest activity will be confined to namespace: chaosclaw

Next
  chaosclaw recon webhooks --context prod-us-east
```

**Namespace already exists (idempotent):**

```
Warning
  Namespace chaosclaw already exists

  [OK] ResourceQuota verified (idempotent)
  [OK] ServiceAccount already present
  [OK] RBAC bindings verified

Ready
  Namespace chaosclaw is ready
```

**Hard error — cannot create namespace:**

```
Error
  Cannot create namespace "chaosclaw"

Reason
  Current credentials do not have permission to create namespaces

Next
  - Run chaosclaw verify preflight to diagnose cluster permissions
  - Or use an existing namespace: chaosclaw recon init --namespace <name>
  - Pentest cannot proceed without an isolated namespace
```

---

### 7.2 `chaosclaw recon webhooks`

Queries `ValidatingWebhookConfiguration` and `MutatingWebhookConfiguration`. The key finding is `failurePolicy: Ignore` — a webhook configured this way fails open, meaning if it goes down, admission is bypassed.

**Findings present:**

```
$ chaosclaw recon webhooks --context prod-us-east

ChaosClaw Recon — Admission Webhooks
Cluster Context: prod-us-east

Validating Webhooks (2)

  kyverno-policy-validating-webhook-cfg
    Rules: 3    Failure policy: Fail    Scope: cluster-wide

  custom-security-webhook
    Rules: 1    Failure policy: Ignore    Scope: default, production

Mutating Webhooks (1)

  kyverno-policy-mutating-webhook-cfg
    Rules: 2    Failure policy: Fail    Scope: cluster-wide

Findings

  [HIGH] custom-security-webhook — failurePolicy: Ignore
         If this webhook is unreachable, admission is bypassed for: default, production

Next
  chaosclaw recon policies --context prod-us-east
```

**No webhooks found:**

```
Validating Webhooks
  None found

Mutating Webhooks
  None found

Findings
  [HIGH] No admission webhooks detected
         The cluster has no Kyverno, OPA/Gatekeeper, or custom webhook-based admission controls
         Enforcement relies entirely on built-in PSA and ResourceQuota
```

**Partial skip — insufficient RBAC:**

```
Warning — Webhook Recon Skipped

Reason
  Cannot list validatingwebhookconfigurations or mutatingwebhookconfigurations
  Current identity lacks cluster-scoped read access for these resources

Impact
  Admission controller coverage is unknown
  Webhook failure-open risk cannot be assessed — treat as unverified

Next
  Skipping to: chaosclaw recon policies --context prod-us-east
  To enable webhook recon: grant list access for validatingwebhookconfigurations
  and mutatingwebhookconfigurations
```

---

### 7.3 `chaosclaw recon policies`

Auto-detects the policy engine by probing for `clusterpolicies.kyverno.io` (Kyverno) and `constrainttemplates.constraints.gatekeeper.sh` (Gatekeeper). Reports each policy and its enforcement mode. A policy in `Audit` mode is a finding — violations are logged but workloads are not blocked.

**Kyverno detected with an audit-mode policy:**

```
$ chaosclaw recon policies --context prod-us-east

ChaosClaw Recon — Policy Engine
Cluster Context: prod-us-east

Detecting policy engine...
  Kyverno: detected
  OPA/Gatekeeper: not installed
  PSA: checking namespace labels

Kyverno ClusterPolicies (6)

  deny-privileged-containers      Enforce    ✓
  deny-hostpath                   Enforce    ✓
  deny-unapproved-registry        Audit      ← not enforced
  require-labels                  Enforce    ✓
  deny-latest-tag                 Enforce    ✓
  deny-forbidden-capabilities     Enforce    ✓

Findings

  [WARN] deny-unapproved-registry is in Audit mode
         Violations are logged but workloads from unapproved registries will be admitted

Next
  chaosclaw verify run --pack preventive-baseline --context prod-us-east
```

**No policy engine detected:**

```
Detecting policy engine...
  Kyverno: not installed
  OPA/Gatekeeper: not installed
  PSA: no enforce labels found on user namespaces

Findings

  [CRITICAL] No policy engine detected
             Cluster has no admission-level policy enforcement beyond built-in PSA
             All preventive-baseline scenarios will likely be SKIPPED
             This represents a complete gap in preventive control coverage
```

---

### 7.4 `chaosclaw recon rbac`

Lists `ClusterRoles` and `ClusterRoleBindings`. Surfaces principals with `cluster-admin` or unusually broad resource access. `kube-system` service accounts are excluded by default to reduce noise — use `--include-system` to include them.

**Findings present:**

```
$ chaosclaw recon rbac --context prod-us-east

ChaosClaw Recon — RBAC Posture
Cluster Context: prod-us-east

Cluster-admin bindings (2)
  ClusterRoleBinding: cluster-admin → system:masters group  (built-in)
  ClusterRoleBinding: emergency-admin → User: break-glass-user

High-privilege service accounts
  monitoring/monitoring-sa      get, list, watch secrets — cluster-wide    ← FINDING
  ci/ci-runner-sa               create, delete pods — cluster-wide         ← FINDING
  kube-system/cluster-autoscaler list, patch nodes — cluster-wide          (expected)

Findings

  [HIGH] monitoring/monitoring-sa has cluster-wide secret read access
         A compromised token for this account exposes all secrets in all namespaces
  [WARN] ci/ci-runner-sa can create and delete pods across the entire cluster
         CI pipelines should be scoped to their own namespace

Next
  chaosclaw recon nodes --context prod-us-east
```

**Partial skip — can read ClusterRoles but not ClusterRoleBindings:**

```
ClusterRoles (14 found)
  ...

ClusterRoleBindings
  [SKIP] Cannot list clusterrolebindings — insufficient permissions
         Who holds the roles above cannot be determined

Findings
  [WARN] RBAC analysis is incomplete
         clusterrolebindings list access is required for full privilege path analysis
         Roles exist but their principals are unknown
```

---

### 7.5 `chaosclaw recon nodes`

Reads node metadata to surface kernel version, container runtime version, and whether AppArmor and seccomp are active. Version staleness is flagged as `INFO` — not a blocking finding but worth recording.

```
$ chaosclaw recon nodes --context prod-us-east

ChaosClaw Recon — Node Security Posture
Cluster Context: prod-us-east

Nodes (3)

  prod-node-1
    OS: Ubuntu 22.04.3 LTS    Kernel: 5.15.0-91-generic
    Runtime: containerd 1.7.2    AppArmor: enabled    Seccomp: runtime/default

  prod-node-2
    OS: Ubuntu 22.04.3 LTS    Kernel: 5.15.0-91-generic
    Runtime: containerd 1.7.2    AppArmor: enabled    Seccomp: runtime/default

  prod-node-3
    OS: Ubuntu 22.04.3 LTS    Kernel: 5.15.0-88-generic
    Runtime: containerd 1.6.8    AppArmor: enabled    Seccomp: runtime/default

Findings

  [INFO] prod-node-3 is running an older kernel (5.15.0-88) and containerd version (1.6.8)
         Other nodes are on 5.15.0-91 / containerd 1.7.2

Next
  chaosclaw recon network-policies --context prod-us-east
```

---

### 7.6 `chaosclaw recon psa`

Reads PSA enforcement labels from all namespaces. A namespace with no `pod-security.kubernetes.io/enforce` label has no pod security baseline applied — this is a finding.

```
$ chaosclaw recon psa --context prod-us-east

ChaosClaw Recon — Pod Security Admission
Cluster Context: prod-us-east

Namespace              Enforce        Audit          Warn
──────────────────────────────────────────────────────────────────
default                baseline       restricted     restricted
production             restricted     restricted     restricted
staging                baseline       baseline       restricted
kube-system            privileged     —              —
monitoring             —              —              —

Findings

  [WARN] monitoring namespace has no PSA labels
         Pod security is unenforced — any pod spec is admissible in this namespace
```

---

### 7.7 `chaosclaw recon network-policies`

Lists `NetworkPolicy` resources across all namespaces. A namespace with no network policies has unrestricted pod-to-pod traffic — a lateral movement risk.

```
$ chaosclaw recon network-policies --context prod-us-east

ChaosClaw Recon — Network Policies
Cluster Context: prod-us-east

Namespaces with policies
  production    4 policies    ingress + egress defined
  staging       2 policies    ingress only

Namespaces without policies
  default       ← no network isolation
  monitoring    ← no network isolation

Findings

  [HIGH] default namespace has no NetworkPolicies
         All pod-to-pod traffic is unrestricted — lateral movement is unimpeded
  [WARN] monitoring namespace has no NetworkPolicies
         Monitoring data and dashboards are reachable from any pod in the cluster
```

---

### 7.8 `chaosclaw recon runtime-agents`

Scans `DaemonSets` across all namespaces for known runtime detection agents (Falco, KubeArmor, Tetragon, Tracee). Reports per-node coverage. Missing runtime agents are `WARN`-level — the cluster may still have preventive controls, but runtime behavioral detection is absent.

```
$ chaosclaw recon runtime-agents --context prod-us-east

ChaosClaw Recon — Runtime Agents
Cluster Context: prod-us-east

DaemonSets scanned: 6

Runtime Detection
  Falco: detected (3/3 nodes)    ← full node coverage
  KubeArmor: not detected
  Tetragon: not detected
  Tracee: not detected

Findings

  [INFO] Falco is deployed with full node coverage — runtime detection is present
  [WARN] No LSM-based runtime enforcement detected (KubeArmor, Tetragon)
         Suspicious behavior may be detected by Falco but cannot be blocked at the syscall level
```

---

### 7.9 `chaosclaw recon all`

Runs all recon commands sequentially and produces a combined JSON artifact. The primary entry point for the OpenClaw pentest skill.

```
$ chaosclaw recon all --context prod-us-east --output recon.json

ChaosClaw Recon — Full Cluster Survey
Cluster Context: prod-us-east
Namespace: chaosclaw

  [OK]   Namespace initialized
  [OK]   Webhooks surveyed (1 finding)
  [OK]   Policies surveyed (1 finding)
  [OK]   PSA labels surveyed (1 finding)
  [SKIP] RBAC — insufficient permissions (bindings unreadable)
  [OK]   Nodes surveyed (1 finding)
  [OK]   Network policies surveyed (2 findings)
  [OK]   Runtime agents surveyed (1 finding)

Findings Summary
  Critical: 0    High: 2    Warn: 3    Info: 1    Skip: 1

Artifacts
  JSON report written to: recon.json

Next
  chaosclaw verify run --pack preventive-baseline --context prod-us-east
```

---

## 8. File Structure

Following the existing `register*Command` pattern:

```
src/
  cli/
    recon/
      init.ts              ← registerInitCommand(recon)
      webhooks.ts          ← registerWebhooksCommand(recon)
      policies.ts          ← registerPoliciesCommand(recon)
      psa.ts               ← registerPsaCommand(recon)
      rbac.ts              ← registerRbacCommand(recon)
      nodes.ts             ← registerNodesCommand(recon)
      network-policies.ts  ← registerNetworkPoliciesCommand(recon)
      runtime-agents.ts    ← registerRuntimeAgentsCommand(recon)
      all.ts               ← registerAllCommand(recon)
  core/
    recon/
      init.ts              ← ReconInitEngine
      webhooks.ts          ← WebhookReconEngine
      policies.ts          ← PolicyReconEngine
      psa.ts               ← PsaReconEngine
      rbac.ts              ← RbacReconEngine
      nodes.ts             ← NodeReconEngine
      network-policies.ts  ← NetworkPolicyReconEngine
      runtime-agents.ts    ← RuntimeAgentReconEngine
  types/
    recon.ts               ← ReconResult, ReconFinding, ReconFindingSeverity
```

`program.ts` gets a `recon` parent command alongside the existing `verify` and `scenarios` groups.

---

## 9. Type Contract

`recon.ts` types are intentionally separate from the scenario evidence schema. Recon findings feed OpenClaw for analysis; they are not pass/fail verdicts.

```typescript
type ReconFindingSeverity = 'CRITICAL' | 'HIGH' | 'WARN' | 'INFO' | 'SKIP'

interface ReconFinding {
  severity: ReconFindingSeverity
  title: string
  detail: string
  /** Present on SKIP findings — what permission was missing */
  missingPermission?: string
  /** Present on SKIP findings — what coverage was lost */
  coverageImpact?: string
}

interface ReconToolResult {
  tool: string
  status: 'ok' | 'skip' | 'error'
  findings: ReconFinding[]
  /** Raw structured data from the API — for OpenClaw consumption */
  data: unknown
}

interface ReconReport {
  run_id: string
  cluster_context: string
  namespace: string
  started_at: string
  ended_at: string
  summary: {
    critical: number
    high: number
    warn: number
    info: number
    skip: number
  }
  tools: ReconToolResult[]
}
```
