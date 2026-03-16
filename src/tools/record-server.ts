import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import type { InfrastructureRecord } from "../state/types.js";

export const recordServerSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  provider: z.enum(["hetzner"]).describe("Cloud provider"),
  serverId: z.string().min(1).describe("Provider server ID"),
  serverName: z.string().min(1).describe("Server name"),
  serverIp: z.string().min(1).describe("Server IPv4 address"),
  serverIpv6: z.string().optional().describe("Server IPv6 address"),
  serverType: z.string().min(1).describe("Server type (e.g. cx22)"),
  location: z.string().min(1).describe("Datacenter location"),
  firewallId: z.string().optional().describe("Firewall ID"),
  sshUser: z.string().min(1).describe("SSH user (e.g. deploy)"),
  sshKeyFingerprint: z.string().min(1).describe("SSH key fingerprint used"),
  domain: z.string().optional().describe("Domain name if configured"),
});

export type RecordServerInput = z.infer<typeof recordServerSchema>;

/**
 * Record provisioned server details in project state.
 * Does NOT store tokens — only infrastructure metadata.
 */
export function handleRecordServer(input: RecordServerInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["deployment"], "a2p_record_server"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  const record: InfrastructureRecord = {
    provider: input.provider,
    serverId: input.serverId,
    serverName: input.serverName,
    serverIp: input.serverIp,
    serverIpv6: input.serverIpv6,
    serverType: input.serverType,
    location: input.location,
    firewallId: input.firewallId,
    sshUser: input.sshUser,
    sshKeyFingerprint: input.sshKeyFingerprint,
    domain: input.domain,
    provisionedAt: new Date().toISOString(),
    lastDeployedAt: null,
  };

  const updated = sm.setInfrastructure(record);

  return JSON.stringify({
    success: true,
    infrastructure: updated.infrastructure,
  });
}
