# Example Artifacts — Kubernetes Goat (minikube)

These artifacts were produced by running ChaosClaw against a [Kubernetes Goat](https://madhuakula.com/kubernetes-goat/) cluster on minikube. Kubernetes Goat is a deliberately vulnerable Kubernetes environment designed for security testing.

**Cluster context:** `minikube`  
**Date:** 2026-05-28  
**Overall posture:** Critical

---

## Recon summary (`recon.json`)

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 3 |
| Warn | 2 |

| Tool | Finding |
|---|---|
| `policies` | **CRITICAL** — No policy engine detected. Kyverno and OPA/Gatekeeper are absent; no admission-level enforcement beyond built-in PSA. |
| `webhooks` | **HIGH** — No admission webhooks. Enforcement relies entirely on PSA and ResourceQuota. |
| `network-policies` | **HIGH** — 5 namespaces (`big-monolith`, `chaosclaw`, `chaosclaw-tests`, `default`, `secure-middleware`) have no NetworkPolicies; all pod-to-pod traffic is unrestricted. |
| `runtime-agents` | **HIGH** — Falco, KubeArmor, Tetragon, and Tracee are all absent. Runtime behavioral detection is unavailable. |
| `psa` | **WARN** — 5 user namespaces have no Pod Security Admission labels. |
| `rbac` | **WARN** — `cluster-admin` bound to non-system principal (`kubeadm:cluster-admins`). |

---

## Execution primitive results

### `exec-shadow.json` — Sensitive file read (FAIL)

**Primitive:** `verify exec`  
**Command:** `cat /etc/shadow`  
**Expected:** `failed` (non-zero exit)  
**Observed:** `succeeded` (exit code 0)

The host shadow file was readable from inside the container. With no policy engine and no PSA enforcement, the pod ran without restriction and the file was returned in stdout. This confirms unrestricted host filesystem access.

---

### `detect-nsenter.json` — Runtime detection gap (PASS → Critical finding)

**Primitive:** `verify detect`  
**Technique:** `nsenter` with `hostPID: true`  
**Expected:** `no alert` (no runtime agent installed)  
**Observed:** `no alert observed`

The result is a PASS against expectation, but represents a **Critical** posture finding: a host namespace escape technique executed successfully and went completely undetected. No runtime agent was present to observe or block it.

---

### `identity-chaosclaw-runner.json` — RBAC namespace isolation (PASS)

**Primitive:** `verify identity`  
**Service account:** `chaosclaw-runner`  
**Check:** `create pods` in `default`  
**Expected:** `denied`  
**Observed:** `denied`

Confirms ChaosClaw's own RBAC scoping is working correctly. The test service account is confined to the `chaosclaw` namespace and cannot create workloads outside it.
