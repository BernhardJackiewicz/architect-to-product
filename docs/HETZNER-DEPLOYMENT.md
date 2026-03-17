# Hetzner Deployment & VPS Standard Configuration

A2P generates a hardened VPS configuration that works on any Ubuntu VPS provider. Hetzner Cloud is the default because of its price-performance ratio, but the core config is portable.

## Provider Portability

**The standard config works on every VPS provider that offers Ubuntu machines.** You are not locked into Hetzner. If you choose a different provider, you abstract the Hetzner-specific parts. The generic part is portable.

### Portable (works everywhere)

These components are provider-agnostic and work on any Ubuntu 24.04 VPS:

| Component | What it does |
|---|---|
| **Cloud-init** | User provisioning, package installation, service configuration — standard on all major cloud providers |
| **Docker daemon.json** | Log rotation (`max-size: 10m`, `max-file: 5`) — prevents disk exhaustion from container logs |
| **sysctl hardening** | Kernel network hardening (`tcp_syncookies`, `icmp_echo_ignore_broadcasts`, disable ICMP redirects) — no `ip_forward=0` because Docker needs it |
| **unattended-upgrades** | Automatic security patches without auto-reboot (explicit disable via `51no-auto-reboot`) |
| **Swapfile** | 2G default swap — prevents OOM kills on small instances. Adjust for JVM/multi-service workloads |
| **fail2ban** | SSH brute-force protection (5 retries, 1h ban) |
| **SSH hardening** | Key-only auth, root login disabled, max 3 auth tries |
| **UFW firewall** | Deny incoming by default, allow 22/80/443 only |
| **backup.sh → /backups/** | App-level database + artifact backup with retention and manifest |
| **Offsite backup via rclone** | `rclone copy` to any SFTP/S3 target (NOT `rclone sync` — sync deletes at target) |
| **Restore checks** | Restore to temp directory + integrity verification |
| **App-security checklist** | Body parser size limits, Permissions-Policy, JWT claims, bcrypt rounds, rate-limiter store, source map exclusion |
| **UFW/Docker guidance** | Docker bypasses UFW by default — checklist item reminds to review DOCKER-USER chain for your network topology |
| **logwatch** | Daily log summary reports |

### Provider-specific (may need adaptation)

When switching from Hetzner to another provider, expect small adjustments in these areas:

| Area | Hetzner | Other providers |
|---|---|---|
| **Cloud firewall / Security Groups** | Hetzner Firewall API (`/v1/firewalls`) | AWS Security Groups, DO Firewall, GCP Firewall Rules |
| **Additional Volumes / Mountpoints** | Hetzner Volumes (separate from root disk, NOT included in server backups) | AWS EBS, DO Volumes, GCP Persistent Disks |
| **Snapshot / Backup model** | 7-slot daily rotation, root disk only, +20% server price | Varies: AWS AMI snapshots, DO weekly backups, custom retention |
| **IPv6 default** | Dual-stack by default | Some providers IPv4-only by default or charge for IPv4 |
| **Recovery console / Rescue system** | Hetzner Rescue System (Linux live environment) | AWS EC2 Serial Console, DO Recovery ISO |
| **Block storage behavior** | Hetzner Volumes mount as `/dev/sdb`, ext4 | Provider-specific device names and filesystem defaults |
| **Network naming conventions** | `eth0` on Hetzner cloud servers | May differ (`ens5` on AWS, etc.) |
| **Pre-installed images / Cloud-init version** | Ubuntu 24.04 with cloud-init, minimal pre-installed packages | Image contents and cloud-init version may vary |

## Automatic Server Sizing

A2P automatically selects the right server type based on your tech stack:

| Server Type | RAM | vCPU | Price | Traffic | When selected |
|---|---|---|---|---|---|
| **cx22** | 4 GB | 2 | ~4 EUR/month | 20 TB included | Standard — Python, TypeScript, Go, Rust, Ruby, PHP, C# |
| **cx32** | 8 GB | 4 | ~7 EUR/month | 20 TB included | JVM languages (Java, Kotlin, Scala, Clojure) or multi-service stacks (DB + cache + app) |

**20 TB traffic included** on every Hetzner Cloud instance — no surprise bandwidth bills. This covers most production workloads without additional costs.

The sizing logic (`computeServerType`) checks:
- **JVM languages** → cx32 (JVM memory overhead needs 8 GB)
- **Database + cache** (e.g. PostgreSQL + Redis) → cx32 (multiple services need more RAM)
- **Everything else** → cx22 (4 GB is sufficient for most single-service stacks)

The selected server type, reasoning, and monthly cost are shown to the user before provisioning. The user confirms before any costs are incurred.

## Cloud-Init Configuration

The cloud-init script provisions a production-ready server in one boot. Everything runs automatically — the user waits ~2-3 minutes after server creation, then verifies via SSH.

### What gets installed and configured

**Packages:**
`apt-transport-https`, `ca-certificates`, `curl`, `gnupg`, `lsb-release`, `ufw`, `fail2ban`, `unattended-upgrades`, `logwatch`

**Docker CE:** Installed from Docker's official repository (not Ubuntu's outdated package).

**Files written:**

| File | Purpose |
|---|---|
| `/etc/fail2ban/jail.local` | SSH protection: 5 retries, 1h ban, 10min window |
| `/etc/ssh/sshd_config.d/hardening.conf` | Key-only auth, no root login, max 3 auth tries |
| `/etc/docker/daemon.json` | JSON-file log driver with 10m max-size, 5 files rotation |
| `/etc/sysctl.d/99-hardening.conf` | TCP syncookies, ICMP broadcast ignore, redirect disable |
| `/etc/apt/apt.conf.d/51no-auto-reboot` | Explicit auto-reboot disable for unattended-upgrades |

**Runtime commands:**
1. Docker CE installation from official repo
2. Deploy user creation (sudo + docker groups, SSH key copied from root)
3. UFW firewall (deny incoming, allow 22/80/443)
4. fail2ban enabled
5. SSH hardening applied
6. Unattended security upgrades configured
7. Timezone set to UTC
8. `/opt/app` deployment directory created
9. `/backups` backup directory created
10. 2G swap file created and activated
11. Kernel sysctl hardening applied
12. Docker restarted (to apply daemon.json)

### What is NOT in cloud-init (and why)

| Feature | Reason |
|---|---|
| UFW Docker-patch (DOCKER-USER chain) | Too network-specific for a generic default. Depends on host/bridge/VPN topology. Prompt guidance + checklist item instead |
| Auto-reboot after kernel updates | Ops decision, not a safe default for production. Explicit disable in cloud-init, documented as optional |
| SSH port change | Lockout risk if firewall not synchronized. Documented as optional |
| rkhunter / AIDE | Requires initial database generation, not cloud-init suitable. Checklist item instead |
| 2FA | Requires interactive setup |

## Post-Provisioning Verification

After cloud-init completes (~2-3 min), verify the hardening:

```bash
# Root login disabled
ssh root@SERVER_IP                          # Should be rejected

# Docker log rotation
cat /etc/docker/daemon.json                 # max-size and max-file set

# Swap active
swapon --show                               # Should show 2G swapfile

# Kernel hardening
sysctl net.ipv4.tcp_syncookies              # Must be 1

# Docker volumes on root disk (relevant for server backups)
docker volume inspect <volume>              # Mountpoint should be on root disk

# Backup timer active
systemctl list-timers                       # backup.sh timer should be listed

# Offsite reachable
rclone ls remote:path                       # Connection to offsite storage

# Test restore
# Restore DB from backup to temp dir + integrity check
```

## Hetzner Storage Products

| Product | Use Case | Price | Hardening |
|---|---|---|---|
| **Storage Box** (BX11+) | Offsite backup via rclone/SFTP/rsync/BorgBackup | from 3.81 EUR/month | SFTP/SCP always on port 22. Enable only needed protocols (FTP/SMB/Port-23-SSH only if needed). SSH keys + sub-accounts with restricted directories |
| **Storage Share** | Team file sharing (managed Nextcloud) | from 3.49 EUR/month | Strong passwords, share links with password + expiry, container-isolated |
| **Object Storage** (S3-compatible) | Programmatic backup with versioning, CDN origin | Pay-per-use | Access key + secret key, bucket-level permissions |

**Default recommendation for VPS offsite backup:** Storage Box via SFTP (`rclone copy`).

**Storage Box auth note:** Even with SSH key configured, password auth remains active. This is Hetzner's default behavior. Use sub-accounts with dedicated SSH keys and restricted directories for backup access.

## 3-Layer Backup Strategy

A2P implements a 3-layer backup model for comprehensive data protection:

### Layer 1 — Hetzner Server Backup (Snapshots)

- **What:** Full root disk snapshot (OS, Docker, configs, all data on root disk)
- **Frequency:** Daily, 7-slot retention (Hetzner-managed)
- **Cost:** +20% of server price (~0.70 EUR/month for cx22)
- **Covers:** Everything on the server root disk, including Docker named volumes (default location)
- **Does NOT cover:** Attached Hetzner Volumes
- **Limitation:** 7 slots = 7 days. Not sufficient as sole retention strategy
- **Purpose:** Fast server rebuild after catastrophic failure

**Enable:** Hetzner Console > Server > Backups > Enable (or via API)

### Layer 2 — App-Level Backup (`scripts/backup.sh`)

- **What:** Database dump + application data files → `/backups/` on server
- **Frequency:** Daily via systemd timer (configurable: hourly, custom)
- **Retention:** 14+ days (configurable)
- **Purpose:** Targeted data recovery — corrupted data, accidental deletion, point-in-time rollback
- **Generated by A2P:** Stack-specific backup commands (`pg_dump`, `mysqldump`, `mongodump`, `sqlite3 .backup`)

### Layer 3 — Offsite Replication

- **What:** Copy of app-level backups to external storage
- **Method:** `rclone copy` to Storage Box (SFTP) or Object Storage (S3)
- **Important:** Use `rclone copy`, NOT `rclone sync` — sync deletes at the target what's missing at source
- **Alternatives:** restic or borg (built-in versioning and deduplication)
- **Purpose:** Protection against server deletion, account errors, provider outage

### When each layer matters

| Scenario | Layer 1 | Layer 2 | Layer 3 |
|---|---|---|---|
| Server crashes, need quick rebuild | Sufficient | — | — |
| Need data from 10 days ago | Not enough (7 slots) | Sufficient | Sufficient |
| Accidental `DROP TABLE` | — | Sufficient | Sufficient |
| Server accidentally deleted | — | Lost | Sufficient |
| Hetzner account compromised | — | Lost | Sufficient |
| All three layers configured | Full protection | Full protection | Full protection |

## Deployment Checklist (Hetzner-specific)

A2P automatically adds these checklist items when `hosting: "Hetzner"`:

**Infrastructure:**
- Hetzner automated server backups enabled (covers root disk only, not attached Volumes)
- UFW/Docker interaction reviewed (Docker bypasses UFW by default)
- Docker daemon.json log rotation configured
- Kernel hardening sysctl applied
- Swap configured and active

**Post-deployment (stateful apps):**
- backup.sh writes to /backups/ on server disk
- Offsite copy/replication to Storage Box or S3 configured
- Restore from /backups/ tested
- Restore from offsite tested
- Backup retention defined and enforced
- Backup credential handling reviewed (no plaintext secrets in scripts)

## App-Level Security Checks

During deployment artifact validation, A2P checks:

- **Body parser size limit** — Express/Fastify/Koa: `limit: '100kb'` prevents DoS via large payloads
- **Permissions-Policy header** — Restrict browser APIs: `camera=(), microphone=(), geolocation=()`
- **JWT claims** — `iss` and `aud` recommended for multi-service setups
- **Bcrypt rounds** — Minimum 10, target 12+ depending on performance budget
- **Rate limiter store** — Persistent store (Redis/DB) more robust than in-memory (resets on crash)
- **Source maps** — `.map` files excluded from production Docker image

## SSL/HTTPS & Auto-Renewal

Caddy (the reverse proxy in A2P's Docker VPS stack) handles Let's Encrypt certificates automatically:

- **Provisioning:** Caddy obtains a Let's Encrypt certificate when a request arrives for a configured domain
- **Auto-renewal:** Caddy renews certificates ~30 days before expiry — no certbot, no cron job needed
- **HTTPS redirect:** Caddy redirects HTTP → HTTPS by default
- **HSTS:** Configured in the generated Caddyfile

### SSL Verification Gate

After DNS is configured and Caddy has provisioned the certificate, SSL must be verified before the project can be marked complete:

```bash
# Verify HTTPS works
curl -sI https://DOMAIN         # → 200 with valid cert

# Verify HTTP redirects to HTTPS
curl -sI http://DOMAIN           # → 301/308 to https://

# Verify HSTS header present
curl -sI https://DOMAIN | grep -i strict-transport-security
```

Then call `a2p_verify_ssl` with `method="caddy-auto"`, `issuer="Let's Encrypt"`, `autoRenewal=true`.

**This is a code-enforced gate** — `deployment → complete` is blocked without SSL verification. The gate is automatically invalidated if the infrastructure domain changes.

For PaaS deployments (Vercel, Cloudflare, Railway, Fly.io, Render), SSL is handled automatically by the platform. Call `a2p_verify_ssl` with `method="paas-auto"` and the platform as issuer.

## Secret Management Tiers

A2P enforces a secret management choice before deployment configs can be generated. Four tiers are available:

| Tier | Method | Best for | Trade-off |
|------|--------|----------|-----------|
| **1: env-file** | `.env.production` + `chmod 600` | MVP / sandbox | Simplest — plaintext on disk, no audit trail |
| **2: docker-swarm** | `docker secret create` + `/run/secrets/` | Single-VPS production | Encrypted at rest, no external dependency, zero cost |
| **3: infisical** | Infisical CLI + Machine Identity | Production with audit trail | Centralized management, web UI, rotation, free tier available |
| **4: external** | Vault / AWS SM / Doppler | Enterprise / compliance | Provider-specific, significant ops overhead |

Set via `a2p_set_secret_management` — the tool records the choice in state and adapts deployment config generation accordingly.

## Full Provisioning Flow

1. `a2p_plan_infrastructure` — computes server type, generates cloud-init, firewall rules, provisioning commands
2. User provides Hetzner API token (shell variable only, never persisted)
3. Create firewall via API
4. Select/upload SSH key
5. Create server with cloud-init user_data
6. Wait for cloud-init (~2-3 min)
7. Verify SSH access: `ssh deploy@SERVER_IP "docker --version"`
8. `a2p_set_secret_management` — user chooses secret management tier
9. `a2p_generate_deployment` — generates deployment guidance + Hetzner backup/storage recommendations
10. `a2p_deploy_to_server` — rsync project, docker compose up
11. Configure DNS A-record → server IP
12. `a2p_verify_ssl` — verify HTTPS + auto-renewal after Caddy provisions certificate
13. Verify: health check, security headers, blocked paths
14. Enable Hetzner server backups
15. Configure offsite replication
16. Test restore from both backup layers
