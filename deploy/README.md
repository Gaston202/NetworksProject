# Deployment — LabServer + two clients on VirtualBox

Topology per [ADR-0016](../docs/adr/ADR-0016-lab-topology-server-plus-two-clients.md):
nginx and FastAPI on `LabServer`, browsers on `Client`/`Client2`, all on the
Internal Network `intnet` (192.168.100.0/24). Follow the steps in order.

| VM | Adapter 1 | Adapter 2 | Address |
|----|-----------|-----------|---------|
| `LabServer` (Ubuntu Server 24.04) | NAT | Internal Network `intnet` | `enp0s8` **192.168.100.10/24** static |
| `Client`, `Client2` (Ubuntu Desktop) | Internal Network `intnet` | — | DHCP |

## 1. LabServer network (once)

Static address on the intnet adapter (`/etc/netplan/50-intnet.yaml`, `chmod 600`):

```yaml
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      addresses: [192.168.100.10/24]
```

`sudo netplan apply`, then `ip -4 addr show enp0s8`. No gateway goes on enp0s8,
because the default route (internet, Atlas) stays on the NAT adapter `enp0s3`.

## 2. ssh from the Windows host (once)

The host can't reach `intnet`, and NAT blocks inbound connections, so add a port-forward:

VirtualBox → LabServer → **Settings → Network → Adapter 1 (NAT) → Advanced →
Port Forwarding** → add: Name `ssh`, Protocol `TCP`, Host IP `127.0.0.1`,
Host Port `2222`, Guest Port `22`.

On LabServer: `sudo apt install -y openssh-server`. Then from the host:

```bash
ssh -p 2222 ghass@127.0.0.1
```

## 3. Get the code onto LabServer

```bash
# on LabServer (first time: git clone the repo into /project/NetworksProject)
cd /project/NetworksProject && git pull
```

## 4. Build the SPA on the host and copy it over

Leave `VITE_API_BASE_URL` empty (no `frontend/.env.local`) so the app calls
`/api` on its own origin, which nginx proxies.

```bash
cd frontend && npm run build
scp -P 2222 -r dist ghass@127.0.0.1:/project/NetworksProject/frontend/
```

## 5. Provision the backend (on LabServer)

**Atlas first:** Atlas UI → Network Access must allow the VM's public egress IP
(the NAT adapter shares the host's public IP). For the demo only, you can use
`0.0.0.0/0` and document it as a known limitation.

```bash
sudo env MONGODB_URL='mongodb+srv://<user>:<password>@cluster0.bgop6.mongodb.net/?appName=Cluster0' \
  bash deploy/server-provision.sh
```

The script installs Python, writes `backend/.env` (fresh `SECRET_KEY`) and keeps an
existing one, **always** making it readable by the service user. It seeds Atlas,
installs and restarts `hms-api` (uvicorn on `127.0.0.1:8000`), turns on ufw
(22 on `enp0s3`, 80 on `enp0s8`, everything else denied) and checks the health
endpoint. Interface names can be overridden: `sudo env NAT_IFACE=… LAN_IFACE=… …`.

## 6. Serve SPA + API through nginx (on LabServer)

```bash
sudo bash deploy/nginx-setup.sh
```

It ends with `FRONTEND + API SERVED OK — open http://192.168.100.10/`.

## 7. Verify from a client VM

```bash
ping -c2 192.168.100.10
curl http://192.168.100.10/api/health          # 200
curl -m 3 http://192.168.100.10:8000/          # times out: 8000 is not exposed
python3 http_scenarios.py http://192.168.100.10   # copy deploy/http_scenarios.py over first
```

Open `http://192.168.100.10/` in Firefox on both clients: log in as the doctor
on one and as the patient on the other.

## Useful commands (LabServer)

| Task | Command |
|------|---------|
| Backend logs (live) | `journalctl -u hms-api -f` |
| Restart API | `sudo systemctl restart hms-api` |
| nginx status / test config | `systemctl status nginx` · `sudo nginx -t` |
| Firewall rules | `sudo ufw status verbose` |
| What listens where | `sudo ss -tlnp` |
| Redeploy frontend | rebuild on host, `scp` `dist` again, `sudo bash deploy/nginx-setup.sh` |
| Re-seed demo data | `.venv/bin/python scripts/reset_demo.py` then `.venv/bin/python -m app.seed` (from `backend/`) |

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `hms-api` exits `217/USER` | Re-run `server-provision.sh` from the current code (the unit's `User=` is filled in from the repo owner) |
| `hms-api` crash-loops, log mentions `mongodb_url`/`secret_key` | `.env` unreadable or incomplete: `ls -l backend/.env` should be owned by your user, mode 600 |
| `/api/health` → 503 | Atlas unreachable: Network Access allow-list first, then VM egress (`curl -I https://cloud.mongodb.com`) |
| `502 Bad Gateway` from nginx | nginx is up, uvicorn isn't: `journalctl -u hms-api -n 50` |
| Client can't load the page | Same `intnet` name on both VMs? `ip a` on the client; `sudo ufw status` on the server |
