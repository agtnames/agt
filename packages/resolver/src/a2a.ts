/**
 * Interop exports (#363): an A2A agent card and an ERC-8004 registration file, both derived from a resolved name.
 *
 * `agentCardFrom(resolution)` gives frameworks that take an agent card URL (Google ADK `RemoteA2aAgent`, Microsoft
 * Agent Framework `A2AAgent`, a2a-python `A2ACardResolver`) a card for any .agt name whose owner published an `a2a`
 * endpoint; agtnames.com serves it at /api/v2/agent-card/<label>. Manifest fields are used only when the manifest
 * verified against the on-chain owner; otherwise the card carries just the endpoint from the on-chain record.
 *
 * `erc8004RegistrationFrom(manifest)` turns a manifest into the JSON an ERC-8004 identity registration points at
 * (services, x402 support, existing registrations). Export today, on-chain registration later (roadmap).
 */
import type { AgtManifest } from "./manifest.js";

export const A2A_PROTOCOL_VERSION = "1.0";
export const ERC8004_REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
const SITE = "https://agtnames.com";

/** The subset of AgentResolution the card needs; the site builds the same input from its own manifest loader. */
export interface CardSource {
  /** `label.agt` */
  name: string;
  owner: string | null;
  manifest: AgtManifest | null;
  verified: boolean;
  /** On-chain endpoint records, protocol → url. */
  endpoints?: Record<string, string>;
}

export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** A2A agent card (protocol 1.0 shape; unknown fields are avoided so strict parsers accept it). */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: "JSONRPC";
  version: string;
  provider?: { organization: string; url: string };
  iconUrl?: string;
  documentationUrl?: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  supportsAuthenticatedExtendedCard: boolean;
}

const labelOf = (name: string) => name.replace(/\.agt$/, "");
const endpointFor = (src: CardSource, protocol: string): string | null => {
  const m = src.verified ? src.manifest?.endpoints?.find((e) => e.protocol === protocol)?.url : undefined;
  return m ?? src.endpoints?.[protocol] ?? null;
};
const titleCase = (id: string) => id.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/**
 * Builds the agent card, or returns null when the name publishes no `a2a` endpoint (the route answers 404).
 * Description, skills, icon and provider come from the manifest only when it verified.
 */
export function agentCardFrom(src: CardSource): A2AAgentCard | null {
  const url = endpointFor(src, "a2a");
  if (!url) return null;
  const label = labelOf(src.name);
  const m = src.verified ? src.manifest : null;
  const card: A2AAgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: m?.name ?? src.name,
    description: m?.description ?? `${src.name}: an agent named on the .agt registry.${src.verified ? "" : " Its manifest is not verified; only the on-chain endpoint is used here."}`,
    url,
    preferredTransport: "JSONRPC",
    version: m?.updated ?? "1",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: (m?.capabilities ?? []).map((c) => ({ id: c.id, name: titleCase(c.id), description: c.description ?? `${titleCase(c.id)} (capability id ${c.id} in the .agt vocabulary).`, tags: [c.id, "agt"] })),
    supportsAuthenticatedExtendedCard: false,
  };
  if (src.owner) card.provider = { organization: m?.website ? hostOf(m.website) ?? src.owner : src.owner, url: m?.website ?? `${SITE}/name/${label}` };
  if (m?.icon && /^https:\/\//.test(m.icon)) card.iconUrl = m.icon;
  card.documentationUrl = `${SITE}/name/${label}`;
  return card;
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

export interface Erc8004Service { name: string; endpoint: string; version?: string }
export interface Erc8004Registration {
  type: typeof ERC8004_REGISTRATION_TYPE;
  name: string;
  description?: string;
  image?: string;
  services: Erc8004Service[];
  x402Support: boolean;
  active: boolean;
  registrations: { agentId: string; agentRegistry: string }[];
  supportedTrust: string[];
  /** Provenance back to .agt (extra field; the registration JSON is free-form). */
  agt: { name: string; owner: string; manifest?: string };
}

const SERVICE_NAMES: Record<string, string> = { a2a: "A2A", mcp: "MCP", http: "web", ws: "websocket", grpc: "grpc" };

/**
 * ERC-8004 registration file for a manifest. `manifestUri` (the on-chain pointer) is recorded under `agt` so the
 * 8004 record can be traced back to the signed document.
 */
export function erc8004RegistrationFrom(manifest: AgtManifest, opts: { manifestUri?: string; active?: boolean } = {}): Erc8004Registration {
  const services: Erc8004Service[] = (manifest.endpoints ?? []).map((e) => ({ name: SERVICE_NAMES[e.protocol] ?? e.protocol, endpoint: e.url, ...(e.version ? { version: e.version } : {}) }));
  if (manifest.website && !services.some((s) => s.name === "web")) services.push({ name: "web", endpoint: manifest.website });
  const registrations = (manifest.registrations ?? [])
    .filter((r) => r.standard === "erc-8004" && r.registry)
    .map((r) => ({ agentId: String(r.agentId ?? ""), agentRegistry: `eip155:${r.chainId ?? 137}:${r.registry}` }));
  const out: Erc8004Registration = {
    type: ERC8004_REGISTRATION_TYPE,
    name: manifest.name,
    services,
    x402Support: (manifest.payments ?? []).some((p) => p.rail === "x402"),
    active: opts.active ?? true,
    registrations,
    supportedTrust: ["reputation"],
    agt: { name: manifest.name, owner: manifest.owner, ...(opts.manifestUri ? { manifest: opts.manifestUri } : {}) },
  };
  if (manifest.description) out.description = manifest.description;
  if (manifest.icon) out.image = manifest.icon;
  return out;
}
