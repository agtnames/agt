/**
 * Legacy DNS fallback: read TXT records for a .agt name over DNS-over-HTTPS and
 * interpret Manifest v1 (inline `agt-*` records) or a v2/v3 `agt-manifest=` pointer.
 * Default resolver is a Handshake-aware DoH endpoint; configurable.
 */
export interface DnsTxtResult {
  records: string[];
  manifestUri: string | null;   // from agt-manifest=
  inlineV1: Record<string, string[]> | null; // agt-* records when agt-version=1 is present
}

export async function dnsTxt(name: string, opts: { dohUrl?: string; timeoutMs?: number } = {}): Promise<DnsTxtResult> {
  const doh = (opts.dohUrl ?? "https://hnsdoh.com/dns-query").replace(/\/$/, "");
  const url = `${doh}?name=${encodeURIComponent(name)}&type=TXT`;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), opts.timeoutMs ?? 8_000);
  try {
    const r = await fetch(url, { headers: { accept: "application/dns-json" }, signal: c.signal });
    if (!r.ok) throw new Error(`DoH ${url} → HTTP ${r.status}`);
    const j = (await r.json()) as { Answer?: { type: number; data: string }[] };
    const records = (j.Answer ?? []).filter((a) => a.type === 16).map((a) => unquoteTxt(a.data));
    const manifest = records.find((s) => s.startsWith("agt-manifest="));
    const manifestUri = manifest ? manifest.slice("agt-manifest=".length).trim() : null;
    let inlineV1: Record<string, string[]> | null = null;
    if (records.some((s) => s === "agt-version=1")) {
      inlineV1 = {};
      for (const rec of records) {
        const i = rec.indexOf("=");
        if (i < 0 || !rec.startsWith("agt-")) continue;
        const k = rec.slice(0, i), v = rec.slice(i + 1);
        (inlineV1[k] ??= []).push(v);
      }
    }
    return { records, manifestUri, inlineV1 };
  } finally {
    clearTimeout(t);
  }
}

/** DoH returns TXT as one or more quoted strings; join and unquote. */
function unquoteTxt(data: string): string {
  const parts = data.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!parts) return data;
  return parts.map((p) => p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")).join("");
}

/** Lift Manifest v1 inline TXT records into a manifest-shaped object (unsigned, lower trust). */
export function inlineV1ToManifest(name: string, rec: Record<string, string[]>) {
  const one = (k: string) => rec[k]?.[0];
  const endpoints = Object.keys(rec)
    .filter((k) => k.startsWith("agt-endpoint-"))
    .map((k) => ({ protocol: k.slice("agt-endpoint-".length), url: rec[k][0] }));
  return {
    agt: "1.0",
    name,
    owner: one("agt-owner") ?? "",
    description: one("agt-description"),
    icon: one("agt-icon"),
    website: one("agt-website"),
    displayName: one("agt-name"),
    endpoints,
    capabilities: (rec["agt-cap"] ?? []).map((id) => ({ id })),
    protocols: rec["agt-protocol"] ?? [],
    pricing: one("agt-pricing"),
    legacy: true,
  };
}
