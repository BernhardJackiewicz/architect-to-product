import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";

export const planInfrastructureSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  provider: z.enum(["hetzner"]).default("hetzner").describe("Cloud provider"),
  location: z.string().default("nbg1").describe("Datacenter location (default: nbg1)"),
});

export type PlanInfrastructureInput = z.infer<typeof planInfrastructureSchema>;

interface FirewallRule {
  direction: "in";
  protocol: "tcp";
  port: string;
  sourceIps: string[];
  description: string;
}

/**
 * Compute server sizing, firewall rules, cloud-init script, and provisioning commands.
 * Returns a plan — Claude executes the commands via Bash.
 */
export function handlePlanInfrastructure(input: PlanInfrastructureInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["deployment"], "a2p_plan_infrastructure"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  if (!state.deployApprovalAt) {
    return JSON.stringify({ error: "Deploy approval required. Call a2p_deploy_approval first." });
  }

  if (!state.architecture) {
    return JSON.stringify({ error: "No architecture set." });
  }

  const tech = state.architecture.techStack;
  const provider = input.provider;
  const location = input.location;
  const serverType = computeServerType(tech);
  const image = "ubuntu-24.04";

  const firewallRules: FirewallRule[] = [
    { direction: "in", protocol: "tcp", port: "22", sourceIps: ["0.0.0.0/0", "::/0"], description: "SSH" },
    { direction: "in", protocol: "tcp", port: "80", sourceIps: ["0.0.0.0/0", "::/0"], description: "HTTP" },
    { direction: "in", protocol: "tcp", port: "443", sourceIps: ["0.0.0.0/0", "::/0"], description: "HTTPS" },
  ];

  const cloudInitScript = generateCloudInit();
  const serverName = `${state.projectName}-prod`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

  const provisioningSteps = [
    {
      step: 1,
      description: "Create firewall",
      command: `curl -s -X POST https://api.hetzner.cloud/v1/firewalls -H "Authorization: Bearer $HETZNER_TOKEN" -H "Content-Type: application/json" -d '${JSON.stringify({
        name: `${serverName}-fw`,
        rules: firewallRules.map(r => ({
          direction: r.direction,
          protocol: r.protocol,
          port: r.port,
          source_ips: r.sourceIps,
          description: r.description,
        })),
      })}'`,
    },
    {
      step: 2,
      description: "List SSH keys (pick one to use)",
      command: `curl -s https://api.hetzner.cloud/v1/ssh_keys -H "Authorization: Bearer $HETZNER_TOKEN" | jq '.ssh_keys[] | {id, name, fingerprint}'`,
    },
    {
      step: 3,
      description: "Create server (replace SSH_KEY_ID and FIREWALL_ID with actual values)",
      command: `curl -s -X POST https://api.hetzner.cloud/v1/servers -H "Authorization: Bearer $HETZNER_TOKEN" -H "Content-Type: application/json" -d '${JSON.stringify({
        name: serverName,
        server_type: serverType.type,
        image,
        location,
        ssh_keys: ["$SSH_KEY_ID"],
        firewalls: [{ firewall: "$FIREWALL_ID" }],
        user_data: "$CLOUD_INIT",
      })}'`,
      note: "Replace $SSH_KEY_ID, $FIREWALL_ID with actual values from steps 1-2. Replace $CLOUD_INIT with the cloud-init script.",
    },
    {
      step: 4,
      description: "Poll server status until running",
      command: `curl -s https://api.hetzner.cloud/v1/servers/$SERVER_ID -H "Authorization: Bearer $HETZNER_TOKEN" | jq '.server.status'`,
      note: "Repeat until status is 'running'. Then wait ~2-3 min for cloud-init to finish.",
    },
    {
      step: 5,
      description: "Verify SSH access (after cloud-init completes)",
      command: `ssh -o StrictHostKeyChecking=accept-new deploy@$SERVER_IP "docker --version && docker compose version"`,
    },
  ];

  const sshKeyFlow = {
    step1: "List local SSH keys: ls ~/.ssh/*.pub",
    step2: "User picks which key to use",
    step3: "Check if key already registered at Hetzner (step 2 above)",
    step4: "If not registered, upload: curl -s -X POST https://api.hetzner.cloud/v1/ssh_keys -H 'Authorization: Bearer $HETZNER_TOKEN' -H 'Content-Type: application/json' -d '{\"name\": \"<key-name>\", \"public_key\": \"<key-content>\"}'",
  };

  return JSON.stringify({
    provider,
    serverType,
    image,
    location,
    firewallRules,
    cloudInitScript,
    estimatedMonthlyCost: serverType.cost,
    serverName,
    provisioningSteps,
    sshKeyFlow,
    securityNote: "API token stays in $HETZNER_TOKEN shell variable only. Never persisted to files or state.",
  });
}

function computeServerType(tech: { language: string; database: string | null; other: string[] }): {
  type: string;
  ram: string;
  vcpu: number;
  reasoning: string;
  cost: string;
} {
  const lang = tech.language.toLowerCase();
  const db = (tech.database ?? "").toLowerCase();
  const other = tech.other.map(o => o.toLowerCase()).join(" ");

  // Multi-service (DB + cache + app)
  const hasCache = other.includes("redis") || other.includes("memcached");
  const hasHeavyDb = db.includes("postgres") || db.includes("mysql") || db.includes("mariadb") || db.includes("mongo");

  if (hasCache && hasHeavyDb) {
    return { type: "cx32", ram: "8GB", vcpu: 4, reasoning: "Multiple services (DB + cache + app) need more RAM", cost: "~7 EUR/month" };
  }

  // JVM languages need more RAM
  if (lang.includes("java") || lang.includes("kotlin") || lang.includes("scala") || lang.includes("clojure")) {
    return { type: "cx32", ram: "8GB", vcpu: 4, reasoning: "JVM memory overhead requires more RAM", cost: "~7 EUR/month" };
  }

  // Standard for everything else
  return { type: "cx22", ram: "4GB", vcpu: 2, reasoning: "Standard for " + lang + (hasHeavyDb ? " + " + tech.database : ""), cost: "~4 EUR/month" };
}

function generateCloudInit(): string {
  return `#cloud-config
package_update: true
package_upgrade: true

packages:
  - apt-transport-https
  - ca-certificates
  - curl
  - gnupg
  - lsb-release
  - ufw
  - fail2ban
  - unattended-upgrades
  - logwatch

write_files:
  - path: /etc/fail2ban/jail.local
    content: |
      [sshd]
      enabled = true
      port = 22
      maxretry = 5
      bantime = 3600
      findtime = 600

  - path: /etc/ssh/sshd_config.d/hardening.conf
    content: |
      PasswordAuthentication no
      PermitRootLogin no
      PubkeyAuthentication yes
      MaxAuthTries 3

  - path: /etc/docker/daemon.json
    content: |
      {"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"}}

  - path: /etc/sysctl.d/99-hardening.conf
    content: |
      net.ipv4.tcp_syncookies = 1
      net.ipv4.icmp_echo_ignore_broadcasts = 1
      net.ipv4.conf.all.accept_redirects = 0
      net.ipv4.conf.default.accept_redirects = 0
      net.ipv6.conf.all.accept_redirects = 0

  - path: /etc/apt/apt.conf.d/51no-auto-reboot
    content: |
      Unattended-Upgrade::Automatic-Reboot "false";

runcmd:
  # Install Docker CE
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Create deploy user
  - useradd -m -s /bin/bash -G sudo,docker deploy
  - mkdir -p /home/deploy/.ssh
  - cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  - chown -R deploy:deploy /home/deploy/.ssh
  - chmod 700 /home/deploy/.ssh
  - chmod 600 /home/deploy/.ssh/authorized_keys

  # UFW firewall
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable

  # Fail2ban
  - systemctl enable fail2ban
  - systemctl start fail2ban

  # SSH hardening (restart to apply)
  - systemctl restart sshd

  # Unattended upgrades
  - dpkg-reconfigure -f noninteractive unattended-upgrades

  # Timezone
  - timedatectl set-timezone UTC

  # Deployment directory
  - mkdir -p /opt/app
  - chown deploy:deploy /opt/app

  # Backup directory
  - mkdir -p /backups
  - chown deploy:deploy /backups

  # Swap (2G default — adjust size for workload, e.g. 4G for JVM or multi-service)
  - fallocate -l 2G /swapfile
  - chmod 600 /swapfile
  - mkswap /swapfile
  - swapon /swapfile
  - echo '/swapfile none swap sw 0 0' >> /etc/fstab

  # Apply kernel hardening sysctl
  - sysctl --system

  # Restart Docker to apply daemon.json log rotation
  - systemctl restart docker
`;
}
