# Deployment — two Ubuntu VMs on VirtualBox

Follow in order. Addresses per [ADR-0005](../docs/adr/ADR-0005-virtualbox-network-mode.md).

## 0. Create the NAT network (Windows host)

```powershell
& "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" natnetwork add `
  --netname hmsnet --network "10.0.2.0/24" --enable --dhcp on
& "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" natnetwork list
```

(Or: VirtualBox → File → Tools → NAT Networks → Create, network `10.0.2.0/24`, DHCP on.)

## 1. Create the two VMs

Download ISOs (~5 GB total) and create one VM per file:

| VM | ISO | RAM | Disk | Network |
|----|-----|-----|------|---------|
| `hms-server` | ubuntu-24.04.x-live-server-amd64.iso | 2 GB | 15 GB | NAT Network `hmsnet` |
| `hms-desktop` | ubuntu-24.04.x-desktop-amd64.iso | 4 GB | 25 GB | NAT Network `hmsnet` |

During/after install, set the **static** addresses. On both VMs, first boot once and
run `ip route` to see the gateway (typically `10.0.2.1`), then:

```bash
# /etc/netplan/50-hms.yaml  (chmod 600)
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: false
      addresses: [10.0.2.10/24]   # .20 on hms-desktop
      routes:
        - to: default
          via: 10.0.2.1           # use the gateway from `ip route`
      nameservers:
        addresses: [10.0.2.3, 1.1.1.1]
```

Apply: `sudo netplan apply`. Check: `ping -c2 10.0.2.10` **from the desktop VM**.
(First-boot DNS `.3` is VirtualBox's NAT proxy; add a public fallback.)

Optional host access (demo convenience):

```powershell
& "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" natnetwork modify --netname hmsnet `
  --port-forward-4 "api:tcp:1.2.3.4:8888:[10.0.2.10]:8000"
```

## 2. Provision the backend (on hms-server)

Get the repo onto the VM (`git clone` your private repo — paste a token when asked,
or `scp -r` the folder from the host), then:

```bash
HMS_DB_PASSWORD='pick-a-real-one' sudo bash deploy/server-provision.sh
```

The script installs PostgreSQL, creates the DB, writes `backend/.env` with a fresh
`SECRET_KEY`, generates the initial Alembic migration, migrates, seeds demo data,
installs the `hms-api.service` systemd unit, and verifies with
`curl http://localhost:8000/api/health`.

Confirm from the **desktop VM**: `curl http://10.0.2.10:8000/api/health` → `200`.
Also open `http://10.0.2.10:8000/docs` (Swagger) — Week 1 exit criterion.

## 3. Serve the frontend (on hms-desktop)

Build on the Windows host:

```bash
cd frontend && npm run build
```

Copy `frontend/dist` to the VM (`scp -r dist ubuntu@10.0.2.20:~/repo/frontend/`),
then on the VM:

```bash
sudo bash deploy/desktop-setup.sh
```

Then from any machine on the NAT network: `http://10.0.2.20/` shows the SPA.

## Useful commands

| Task | Command |
|------|---------|
| Backend logs | `journalctl -u hms-api -f` |
| Restart API | `sudo systemctl restart hms-api` |
| Re-seed demo data | drop DB, re-run provision script, or `python -m app.seed` |
| Redeploy frontend | rebuild on host, `scp -r dist/*`, script re-runs fine |