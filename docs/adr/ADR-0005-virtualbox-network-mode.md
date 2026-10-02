# ADR-0005: VirtualBox network mode — NAT Network with static addresses

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Project owner, Claude

## Context

The two VMs (`hms-server`, `hms-desktop`) must talk to each other. Options: Internal
Network, NAT Network, Bridged, NAT + port forwarding. Provisioning needs internet
access (`apt install`, package downloads).

## Decision

Use a VirtualBox **NAT Network** (a single shared NAT network both VMs join), with
static addresses assigned inside it:

| Host | Address | Purpose |
|------|---------|---------|
| `hms-server` | `10.0.2.10` | FastAPI API on port `8000` |
| `hms-desktop` | `10.0.2.20` | nginx serving frontend on port `80` |

- VM→VM traffic: `http://10.0.2.10:8000` from the desktop VM.
- Internet access during provisioning: via the NAT network's gateway.
- Host (Windows) access for demo control: optional per-VM port-forwarding rules
  (e.g., host `8888` → server `8000`, host `8080` → desktop `80`) if needed.

## Consequences

- IP addresses are stable — the frontend's API base URL is hardcoded/configured once
  (`VITE_API_BASE_URL` or equivalent), no DHCP surprises mid-demo.
- Bridged mode was rejected: demo reliability depends on the real LAN.
- Internal Network was rejected: no internet access complicates provisioning.
- Only the API port is exposed to the NAT network; the database left the VM
  entirely — `hms-server` makes **outbound TLS connections to MongoDB Atlas
  (TCP/27017)**, gated by the Atlas IP allow-list (ADR-0004).

## Related

- [ADR-0002](ADR-0002-deployment-topology-two-vms.md)