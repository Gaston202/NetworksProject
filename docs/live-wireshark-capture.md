# Live server-side Wireshark capture

How we watch the LabServer VM's HTTP traffic **live** on the Windows laptop during
the demo — capturing on the **server's own interface** (what the professor grades),
with real client IPs, no `.pcap` files to open afterwards.

## The idea

Wireshark runs on the laptop, but the packets are captured **inside the VM** by
`tcpdump` and streamed to Wireshark over SSH. One process, live, server-side.

```
LabServer VM                         Windows laptop
tcpdump -i enp0s8 -w -   ──SSH (port 2222)──►  Wireshark -k -i -   (live window)
(captures the server's                         (reads the stream from stdin)
 own NIC: every client)
```

## The setup we rely on (already in place)

| Thing | Value | Where it came from |
|-------|-------|--------------------|
| VM user | `ghass` | the LabServer account |
| SSH into the VM | `ssh -p 2222 ghass@127.0.0.1` | NAT port-forward `2222 -> 22` on Adapter 1 |
| SSH auth | key-based, no password | host's `~/.ssh/id_ed25519.pub` is in the VM's `authorized_keys` |
| Server interface to capture | `enp0s8` (bridged to the Wi-Fi) | client traffic arrives here |
| Server IP (DHCP, may change) | e.g. `192.168.1.245` | `ip -br addr show enp0s8` |

> The VM gets its IP by DHCP, so after a reboot it may differ. The capture command
> targets the **interface** `enp0s8`, so it keeps working regardless; only the
> **browser URL** changes. Check it with:
> `ssh -p 2222 ghass@127.0.0.1 "ip -br addr show enp0s8"`

## One-time setup: let tcpdump capture without sudo

`tcpdump` needs root to capture. Instead of typing a sudo password every time, we
grant the binary the two Linux capabilities it needs — **once**, in the VM console:

```bash
sudo setcap cap_net_raw,cap_net_admin+eip $(which tcpdump)
```

- `cap_net_raw` — open raw sockets (read packets).
- `cap_net_admin` — put the interface in promiscuous mode.
- `+eip` — make them effective for any user running the binary.

Check it / undo it:

```bash
getcap $(which tcpdump)              # -> /usr/bin/tcpdump cap_net_admin,cap_net_raw=eip
sudo setcap -r $(which tcpdump)      # remove, if ever needed
```

After this, `tcpdump` runs as `ghass` over SSH with no password prompt.

## Run the live capture

### Option A — Git Bash or cmd.exe (one line)

```bash
ssh -p 2222 ghass@127.0.0.1 "tcpdump -i enp0s8 -s0 -U -w - 'tcp port 80'" | "/c/Program Files/Wireshark/Wireshark.exe" -k -i -
```

(cmd.exe version: `"C:\Program Files\Wireshark\Wireshark.exe"` instead of the
`/c/...` path.)

What the flags do:

- `tcpdump -i enp0s8` — capture the server's bridged interface.
- `-s0` — full packets (no truncation), so payloads/headers are complete.
- `-U` — write each packet immediately → the stream is **live**, not buffered.
- `-w -` — write raw pcap to stdout (the SSH pipe).
- Wireshark `-k` — start capturing at once; `-i -` — read the pcap from stdin.

Leave the terminal open for the whole demo; closing it stops the capture.

### Option B — the double-click launcher

`live-capture.cmd` (project root) wraps Option A for cmd.exe. Double-click it, or:

```
live-capture.cmd
```

### Option C — Wireshark's built-in SSH capture (no command line)

Wireshark → **Capture → Options** → interface **"SSH remote capture: sshdump"** → ⚙:

- **Server:** `127.0.0.1`, Port `2222`
- **Authentication:** Username `ghass`, SSH private key `C:\Users\ghass\.ssh\id_ed25519`
- **Capture:** Remote interface `enp0s8`, Remote capture filter `tcp port 80`
- **Start**

## IMPORTANT: do not use PowerShell for the pipe

PowerShell decodes the piped stream as **text** and re-encodes it, which corrupts
the binary pcap data — Wireshark then gets garbage and the window never opens or
stays empty. Use **Git Bash**, **cmd.exe**, the `.cmd` launcher, or sshdump (Option
C). All of those pass raw bytes.

## Use it during the demo

1. Start the capture (Option A/B/C).
2. Open the app: `http://<server IP>` (e.g. `http://192.168.1.245`),
   login `patient@hms.example.com` / `hms-demo-1234`.
3. In Wireshark's **display** filter bar: `http` → only requests/responses.
4. Run the 7 scenarios; per-scenario filters:
   `tcp.flags.syn == 1 && tcp.port == 80` (handshake),
   `http.response.code == 401 | 403 | 404 | 409`.
5. Right-click a request → **Follow → HTTP Stream** to read it as text.

Because we capture on the server, **every client** shows up with its **real IP** —
including both clients in the 409 booking race.

## Why not just capture on the laptop's Wi-Fi?

We tested it: capturing on the host Wi-Fi adapter saw **0 packets** of the VM's
traffic. Wi-Fi cards don't do true promiscuous capture on Windows (Npcap), and the
bridged VM's frames use the VM's own MAC, so the host adapter never surfaces them.
Capturing inside the VM avoids all of that and is the server-side view the
professor asks for.

## Troubleshooting

| Problem | Fix |
|---|---|
| Wireshark doesn't open / empty | You used PowerShell — use Git Bash / cmd / the `.cmd` launcher |
| `tcpdump: ... Operation not permitted` | `setcap` not applied — re-run the one-time command in the VM |
| `ssh: connect to host 127.0.0.1 port 2222: Connection refused` | VM not running, or SSH `2222->22` NAT forward missing |
| Permission/key prompt on ssh | key not loaded — confirm `ssh -p 2222 ghass@127.0.0.1` logs in on its own |
| Browser can't open the app | wrong IP — check `ip -br addr show enp0s8`, use that `192.168.1.x` |
| No packets while browsing | capturing the wrong interface, or you browsed over NAT `localhost` (that's `enp0s3`, not `enp0s8`) |
