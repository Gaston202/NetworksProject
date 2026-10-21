# Hotspot demo + Wireshark capture

How to run HMS on `LabServer`, let a colleague on the same Wi-Fi hotspot use it
from his own laptop, and record the HTTP traffic in Wireshark.

Our VMs (checked with `VBoxManage list vms`):

| VM | Adapter 1 | Adapter 2 |
|----|-----------|-----------|
| `LabServer` | NAT (internet, Atlas) | **Bridged** → `Realtek 8822CE Wireless LAN` (hotspot) |
| `Client`, `Client2` | NAT | Internal Network `intnet` |

> For the normal lab setup (everything on `intnet`, server at `192.168.100.10`)
> follow [DEPLOY.md](../DEPLOY.md) instead.

---

## 1. Run the server on LabServer

The API runs as a systemd service (`hms-api`) behind nginx on port 80. It was
installed once with `deploy/server-provision.sh`, so you never start uvicorn by hand.

```bash
sudo systemctl restart hms-api nginx
systemctl status hms-api --no-pager
```

After pulling new code:

```bash
cd ~/NetworksProject
git pull
sudo bash deploy/server-provision.sh
sudo bash deploy/build-frontend.sh
sudo bash deploy/nginx-setup.sh
```

If it fails: `journalctl -u hms-api -n 30`.

## 2. Why the colleague can't use `intnet`

- `intnet` only exists **inside one PC's VirtualBox**. His client VM is on his
  laptop, on a different `intnet`, so the two never meet.
- The NAT adapter blocks connections coming from outside.

Fix: put the server's Adapter 2 directly on the hotspot with **Bridged** mode.

## 3. Put LabServer on the hotspot

1. Connect your PC to the colleague's hotspot.
2. Power off LabServer → **Settings → Network → Adapter 2** → *Attached to:*
   **Bridged Adapter**, *Name:* your **Wi-Fi card**. Leave Adapter 1 on NAT.
3. Boot LabServer and let `enp0s8` get an address from the hotspot:

   ```bash
   sudo tee /etc/netplan/50-intnet.yaml > /dev/null <<'EOF'
   network:
     version: 2
     ethernets:
       enp0s8:
         dhcp4: true
         dhcp4-overrides:
           use-routes: false
   EOF
   sudo netplan apply
   ip -br addr show enp0s8
   ```

   Note the address (e.g. `192.168.43.x` / `172.20.10.x`): this is the
   **server IP** for everything below. `use-routes: false` keeps internet
   traffic on the NAT adapter.

4. **Allow the new public IP in Atlas.** On a hotspot your internet IP
   changes, so Atlas blocks the API until you add it:

   ```bash
   curl -s https://ifconfig.me; echo      # add this IP in Atlas → Network Access
   sudo systemctl restart hms-api
   curl http://<server IP>/api/health     # {"status":"ok",...}
   ```

No firewall or nginx changes needed: ufw already allows port 80 on `enp0s8`,
and nginx listens on all interfaces.

## 4. Colleague opens the site

From his laptop's browser (simplest) or a client VM bridged to his Wi-Fi card:

```
http://<server IP>
```

Patient demo login: `patient@hms.example.com` / `hms-demo-1234`
(every demo account uses `hms-demo-1234`).

If it doesn't load, from his laptop: `ping <server IP>`.
- No reply → the hotspot has **client isolation** (devices can't talk to each
  other). Use another network or turn that setting off.
- Replies but `503` / errors → Atlas allow-list (step 3.4).

## 5. Capture the traffic with Wireshark

Wireshark runs on **your Windows PC**, not in a VM. VirtualBox records the
VM's network card to a `.pcap` file (`nictrace`), then you open that file in
Wireshark. It works for any attachment type, so bridged is fine.

Only LabServer runs on your PC, so capture its **Adapter 2** (the bridged one).
That's the best file anyway: it sees every client's requests.

**PowerShell on the host:**

```powershell
mkdir C:\captures -Force
$env:Path += ";C:\Program Files\Oracle\VirtualBox"

# check adapter 2 says "Bridged Interface"
VBoxManage showvminfo "LabServer" | findstr /i "NIC"

# start recording (VM running)
VBoxManage controlvm "LabServer" nictracefile2 "C:\captures\server-hotspot.pcap"
VBoxManage controlvm "LabServer" nictrace2 on
```

**Generate traffic:** the colleague opens `http://<server IP>`, logs in as the
patient, clicks around. Press `Ctrl+Shift+R` to avoid cached pages, or use
`curl http://<server IP>/api/health`.

**Stop recording before opening the file** (otherwise it may be empty or cut):

```powershell
VBoxManage controlvm "LabServer" nictrace2 off
```

Open `C:\captures\server-hotspot.pcap` in Wireshark.

### Filters

| Filter | Shows |
|---|---|
| `http` | Only website/API requests and responses |
| `ip.addr == <colleague IP> && tcp.port == 80` | His whole conversation incl. TCP handshake |
| `http.request.method == "GET"` | Page and API reads |
| `http.request.method == "POST"` | The login request |

Find the colleague's IP as the source of the first `GET /`.

**Follow a conversation:** right-click an HTTP packet → **Follow → TCP Stream**.

### What to show

1. TCP three-way handshake (SYN, SYN-ACK, ACK) before each HTTP exchange.
2. `GET /` for the page, `GET /api/...` for the app's API calls, their
   `Host` / `User-Agent` headers.
3. Response status lines (`200 OK`, `401`, ...) and bodies.
4. **The login POST shows the email and password in plain text**: the site
   uses HTTP, not HTTPS, so anyone on the network can read them. This is why
   real sites use HTTPS (links to the MITM topic).

### Colleague's own capture (optional)

- Browsing from his laptop's browser → Wireshark live on his **Wi-Fi**
  interface, filter `http`. No VirtualBox needed.
- Browsing from a client VM → same `nictrace` commands on his PC with his VM's
  name and adapter number (check with `showvminfo`).

## 6. Capturing in the normal lab setup (intnet)

Same commands; all our VMs have `intnet` on **adapter 2**:

```powershell
VBoxManage controlvm "LabServer" nictracefile2 "C:\captures\server.pcap"
VBoxManage controlvm "LabServer" nictrace2 on
VBoxManage controlvm "Client" nictracefile2 "C:\captures\client1.pcap"
VBoxManage controlvm "Client" nictrace2 on
VBoxManage controlvm "Client2" nictracefile2 "C:\captures\client2.pcap"
VBoxManage controlvm "Client2" nictrace2 on
# browse http://192.168.100.10 from Client, then:
VBoxManage controlvm "LabServer" nictrace2 off
VBoxManage controlvm "Client" nictrace2 off
VBoxManage controlvm "Client2" nictrace2 off
```

Use **File → Merge** in Wireshark to view several files together.

## 7. Back to the lab setup

1. Power off LabServer → Adapter 2 → **Internal Network `intnet`**.
2. Restore the static address:

   ```bash
   sudo tee /etc/netplan/50-intnet.yaml > /dev/null <<'EOF'
   network:
     version: 2
     ethernets:
       enp0s8:
         dhcp4: false
         addresses: [192.168.100.10/24]
   EOF
   sudo netplan apply
   ```

## Troubleshooting

| Problem | Fix |
|---|---|
| No HTTP in the capture | Wrong adapter (NIC 1 is NAT), trace started after browsing, or cached page |
| Empty `.pcap` | Trace still on: turn it `off` first; check `C:\captures` exists |
| `VBoxManage` not recognized | Re-run the `$env:Path` line |
| Colleague can't ping the server | Hotspot client isolation, or Adapter 2 not bridged to the Wi-Fi card |
| `/api/health` → `503` | Atlas doesn't allow the hotspot's public IP |
| `502 Bad Gateway` | `sudo systemctl restart hms-api`, then `journalctl -u hms-api -n 30` |
