# ADR-0001: Project purpose and evaluation criteria

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

A hospital management system (HMS) could be framed as a networks course project, a
portfolio piece, or a pure learning exercise. The framing decides what "done" means:
which parts get rigor (deployment, networking, demo) and which get trimmed (feature
breadth, production hardening). The working directory is `NetworksProject`.

## Decision

This is a **networks course project**. The evaluated deliverables are:

1. The VM topology: two VirtualBox VMs (Ubuntu Server, Ubuntu Desktop) communicating
   over a virtual network.
2. Client–server interaction: frontend → backend over HTTP (REST).
3. A working end-to-end live demo.

Feature breadth is subordinate to a reliable demo.

## Consequences

- Deployment must be scripted and repeatable (provisioning/setup scripts), because the
  demo may be rebuilt from snapshots.
- Static IPs and known ports are required so URLs are stable during the demo.
- Seed/demo data is a first-class requirement, not an afterthought.
- Production concerns (TLS, secrets management, autoscaling) are out of scope unless
  they demonstrably earn marks.

## Related

- [ADR-0002](ADR-0002-deployment-topology-two-vms.md) — the topology itself
- [ADR-0005](ADR-0005-virtualbox-network-mode.md) — network mode between the VMs