# ChaosClaw

ChaosClaw is a safe, namespace-scoped execution environment for Kubernetes security verification. It proves whether your Kubernetes guardrails actually work — not just whether they are configured — and serves as the controlled execution sandbox for OpenClaw-driven pentesting.

All execution is confined to a dedicated, RBAC-enforced test namespace. ChaosClaw structurally cannot touch any other namespace in the cluster.

## Installation

Requires Node.js ≥ 22.16.0.

```bash
npm install -g chaosclaw
```

To try without installing:

```bash
npx chaosclaw --help
```

## Quick start

```bash
# Initialize the test namespace
chaosclaw recon init

# Survey the cluster's security posture (read-only)
chaosclaw recon all --output recon.json

# Check the cluster is ready for verification
chaosclaw verify preflight

# Run the preventive baseline pack
chaosclaw verify run --pack preventive-baseline --output result.json

# Run a single scenario
chaosclaw verify run --scenario deny-hostpath --context prod-us-east

# Test an arbitrary manifest
chaosclaw verify run --manifest ./my-pod.yaml --expect rejected
```

Results are `PASS`, `FAIL`, `ERROR`, or `SKIPPED`. Every run produces a structured JSON evidence artifact.

## Docs

- [Architecture](docs/architecture.md) — system design, safety model, multi-cluster model, and roadmap
- [CLI Design & Screen Library](docs/design.md) — UX principles, workflows, command model, and canonical terminal output examples
- [Reference](docs/reference.md) — complete command reference, flags, exit codes, and OpenClaw skill setup
- [Scenarios](docs/scenarios.md) — full scenario library with control objectives, FAIL explanations, and remediation
- [Recon Layer](docs/recon-design.md) — reconnaissance commands, flag design, and output specs
- [Execution Layer](docs/execution-layer-design.md) — execution primitives, evidence schema, and OpenClaw usage patterns
- [Case Study: Kubernetes Goat](docs/case-study-kubernetes-goat.md) — end-to-end run against a deliberately vulnerable cluster
- [Progress](docs/progress.md) — implementation status by phase
