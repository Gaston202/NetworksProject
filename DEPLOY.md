# Deploy HMS on your own VMs

A step-by-step guide for team members. You type every command **directly in the
VM's window** (no SSH). It takes about 20 minutes, mostly waiting for downloads.

**What you'll end up with:**

```
 Client VM (browser)  ──  internal network "intnet"  ──  Server VM 192.168.100.10
                                                          ├─ nginx (port 80): website + forwards /api
                                                          └─ API server ──► MongoDB Atlas (internet, via NAT)
```

**Before you start, ask Ghassen for:**
1. The **MongoDB connection string** (`mongodb+srv://...`). It contains a password:
   don't post it in the group chat and never commit it.
2. To **allow your internet IP in MongoDB Atlas** (step 4 tells you how to find it).

---

## 1. VirtualBox settings (VMs switched off)

**Server VM** (Ubuntu Server 24.04) → Settings → Network:

| Adapter | Attached to | Name |
|---------|-------------|------|
| Adapter 1 | NAT | — |
| Adapter 2 | Internal Network | `intnet` |

**Client VM(s)** (Ubuntu Desktop) → Settings → Network:

| Adapter | Attached to | Name |
|---------|-------------|------|
| Adapter 1 | Internal Network | `intnet` |

The name must be exactly `intnet` on every VM, or they can't see each other.

**Give the clients automatic addresses.** On your **Windows** PC, open PowerShell
and run this once. It creates a DHCP server for `intnet` that hands out
192.168.100.100 to .200:

```powershell
& "C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" dhcpserver add --network=intnet --server-ip=192.168.100.1 --netmask=255.255.255.0 --lower-ip=192.168.100.100 --upper-ip=192.168.100.200 --enable
```

(If it says the server already exists, that's fine.)

## 2. Server VM: fixed IP address

Start the server VM and log in. Check your network card names:

```bash
ip -br addr
```

You should see two cards, usually `enp0s3` (NAT, has a `10.0.2.x` address) and
`enp0s8` (internal network, no address yet). **If your names are different,
replace `enp0s8` below with yours.**

Give the internal card the fixed address `192.168.100.10`:

```bash
sudo tee /etc/netplan/50-intnet.yaml > /dev/null <<'EOF'
network:
  version: 2
  ethernets:
    enp0s8:
      dhcp4: false
      addresses: [192.168.100.10/24]
EOF
sudo chmod 600 /etc/netplan/50-intnet.yaml
sudo netplan apply
ip -br addr show enp0s8
```

The last command must show `192.168.100.10/24`.

## 3. Server VM: download the code

Clone into your **home folder, without `sudo`** (a repo owned by root breaks `git`):

```bash
cd ~
git clone https://github.com/Gaston202/NetworksProject.git
cd NetworksProject
```

## 4. Server VM: install the backend

Find your internet IP and **send it to Ghassen** so it can be allowed in Atlas:

```bash
curl -s https://ifconfig.me; echo
```

Once Ghassen confirms, run this, pasting the connection string between the
single quotes:

```bash
sudo env MONGODB_URL='PASTE-THE-CONNECTION-STRING-HERE' bash deploy/server-provision.sh
```

It installs Python, creates `backend/.env` with a fresh secret key, starts the
API as a service, and turns on the firewall (port 80 for clients, 22 for admin,
everything else blocked). It must end with:

```
BACKEND PROVISIONED OK
```

> Your network cards aren't `enp0s3`/`enp0s8`? Add them to the command:
> `sudo env NAT_IFACE=yourNatCard LAN_IFACE=yourIntnetCard MONGODB_URL='...' bash deploy/server-provision.sh`

## 5. Server VM: build and publish the website

```bash
sudo bash deploy/build-frontend.sh
sudo bash deploy/nginx-setup.sh
```

The first installs Node.js (only needed to *build* the website) and builds it.
The second installs nginx and publishes the site. It must end with:

```
FRONTEND + API SERVED OK — open http://192.168.100.10/ from a client VM
```

## 6. Test it

**On the server VM:**

```bash
curl http://192.168.100.10/api/health
```

You should get `{"status":"ok","service":"hms-api","version":"0.1.0"}`.

**On a client VM**, open a terminal:

```bash
ip -br addr                        # you need a 192.168.100.x address
ping -c 2 192.168.100.10           # must get replies
```

Then open Firefox at **http://192.168.100.10** and log in. Every demo account
uses the password `hms-demo-1234`:

| Role | Email |
|------|-------|
| Patient | `patient@hms.example.com` |
| Doctor | `amina.haddad@hms.example.com` |
| Admin | `admin@hms.example.com` |

**Optional: the HTTP status-code demo**, run from a client VM:

```bash
wget -q https://raw.githubusercontent.com/Gaston202/NetworksProject/main/deploy/http_scenarios.py
python3 http_scenarios.py http://192.168.100.10
```

This needs internet on the client. If the client only has `intnet`, run the
same `python3` command on the server VM instead, from `~/NetworksProject/deploy`.

## Updating later

When the code changes on GitHub, on the server VM:

```bash
cd ~/NetworksProject
git pull
sudo bash deploy/server-provision.sh          # backend (no connection string needed now)
sudo bash deploy/build-frontend.sh            # website
sudo bash deploy/nginx-setup.sh
```

## If something goes wrong

| What you see | What to do |
|--------------|------------|
| `API health never reported OK` | Run `journalctl -u hms-api -n 30`. If it mentions a timeout or `ServerSelectionTimeoutError`, Atlas doesn't allow your IP yet (step 4). |
| `/api/health` answers `503` | Same cause: Atlas can't be reached. Check the IP allow-list and that the server has internet (`ping -c 2 8.8.8.8`). |
| `502 Bad Gateway` in the browser | nginx works but the API doesn't: `sudo systemctl restart hms-api`, then `journalctl -u hms-api -n 30`. |
| Client has no `192.168.100.x` address | Adapter name isn't exactly `intnet`, or the DHCP server from step 1 is missing. |
| Ping works but the page won't load | `sudo ufw status` on the server must show `80/tcp on enp0s8 ALLOW IN`. |
| `fatal: detected dubious ownership` | The repo was cloned with `sudo`. Fix it with `sudo chown -R $USER: ~/NetworksProject`. |
| `ERROR: no backend/.env yet` | First install needs the connection string: use the full command from step 4. |

More detail: [deploy/README.md](deploy/README.md) (the full runbook) and
[docs/request-flow.md](docs/request-flow.md) (how a request travels through the system).
