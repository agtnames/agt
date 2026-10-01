/**
 * The shared .agt capability vocabulary and its search ranking. One copy, used by the agt CLI's picker and the site's
 * manifest editor, so the same query gives the same order everywhere (agt-site#452).
 *
 * The vocabulary is a snapshot of the site's src/lib/agent-capabilities.ts (the source of truth, rendered at
 * /docs/agt-manifest-spec); clients refresh it from GET https://agtnames.com/api/v2/capabilities when online.
 * Capability ids are not centrally allocated: custom ids are allowed (spec §4.2), lowercase and hyphenated.
 */

export interface CapabilityCategory { id: string; label: string; description: string }

export interface CapabilityDef {
  id: string;
  label: string;
  category: string;
  description: string;
  aliases?: string[];
  deprecated?: boolean;
}

export interface CapabilityVocabulary { categories: CapabilityCategory[]; capabilities: CapabilityDef[] }

export const CAPABILITY_CATEGORIES: CapabilityCategory[] = [
  { id: "language", label: "Language", description: "Text understanding, generation, and transformation" },
  { id: "code", label: "Code", description: "Software development and engineering" },
  { id: "data", label: "Data", description: "Processing, analysis, and computation" },
  { id: "search", label: "Search & Retrieval", description: "Finding and accessing information" },
  { id: "media", label: "Media", description: "Image, audio, video, and multimedia" },
  { id: "communication", label: "Communication", description: "Interaction, messaging, and presentation" },
  { id: "automation", label: "Automation", description: "Workflows, scheduling, and system operations" },
  { id: "security", label: "Security", description: "Protection, compliance, and threat management" },
];

export const CAPABILITIES: CapabilityDef[] = [
  { id: "research", label: "Research", category: "language", description: "Gathers, synthesizes, and cites information from multiple sources." },
  { id: "summarization", label: "Summarization", category: "language", description: "Condenses long-form content into concise summaries." },
  { id: "translation", label: "Translation", category: "language", description: "Translates text between natural languages." },
  { id: "content-writing", label: "Content Writing", category: "language", description: "Generates articles, blog posts, documentation, or other long-form written content." },
  { id: "copywriting", label: "Copywriting", category: "language", description: "Produces marketing copy, ad text, taglines, and promotional content." },
  { id: "editing", label: "Editing", category: "language", description: "Proofreads, corrects grammar, and improves style and clarity." },
  { id: "paraphrasing", label: "Paraphrasing", category: "language", description: "Restates text in different words while preserving meaning." },
  { id: "extraction", label: "Extraction", category: "language", description: "Pulls structured data from unstructured text (entities, dates, amounts)." },
  { id: "classification", label: "Classification", category: "language", description: "Categorizes text by topic, sentiment, intent, or other criteria." },
  { id: "question-answering", label: "Question Answering", category: "language", description: "Answers questions using provided context or general knowledge." },
  { id: "fact-checking", label: "Fact Checking", category: "language", description: "Verifies claims against authoritative sources." },
  { id: "reasoning", label: "Reasoning", category: "language", description: "Performs multi-step logical reasoning and problem solving." },
  { id: "brainstorming", label: "Brainstorming", category: "language", description: "Generates creative ideas, alternatives, and divergent options." },
  { id: "code-generation", label: "Code Generation", category: "code", description: "Writes source code from natural language specifications." },
  { id: "code-review", label: "Code Review", category: "code", description: "Analyzes code for bugs, style issues, and improvement opportunities." },
  { id: "code-explanation", label: "Code Explanation", category: "code", description: "Explains what code does in plain language." },
  { id: "debugging", label: "Debugging", category: "code", description: "Identifies and fixes software bugs." },
  { id: "testing", label: "Testing", category: "code", description: "Writes or executes tests and reports results." },
  { id: "refactoring", label: "Refactoring", category: "code", description: "Restructures code for clarity or performance without changing behavior." },
  { id: "code-documentation", label: "Code Documentation", category: "code", description: "Generates docstrings, READMEs, and technical reference for code." },
  { id: "database-query", label: "Database Query", category: "code", description: "Generates, optimizes, or explains SQL and database queries." },
  { id: "code-completion", label: "Code Completion", category: "code", description: "Provides inline code suggestions and autocompletion." },
  { id: "data-analysis", label: "Data Analysis", category: "data", description: "Performs statistical analysis and extracts insights from structured data." },
  { id: "data-visualization", label: "Data Visualization", category: "data", description: "Creates charts, graphs, dashboards, and visual data representations." },
  { id: "data-cleaning", label: "Data Cleaning", category: "data", description: "Normalizes, deduplicates, and corrects data quality issues." },
  { id: "data-transformation", label: "Data Transformation", category: "data", description: "Converts data between formats, schemas, or structures (ETL)." },
  { id: "math", label: "Math", category: "data", description: "Solves mathematical problems and performs symbolic or numeric computation." },
  { id: "forecasting", label: "Forecasting", category: "data", description: "Builds predictive models and generates time-series forecasts." },
  { id: "anomaly-detection", label: "Anomaly Detection", category: "data", description: "Identifies outliers and unexpected patterns in data." },
  { id: "reporting", label: "Reporting", category: "data", description: "Generates structured reports and executive summaries from data." },
  { id: "embedding", label: "Embedding", category: "data", description: "Generates vector embeddings for text, images, or other inputs." },
  { id: "clustering", label: "Clustering", category: "data", description: "Groups similar items together based on features or content." },
  { id: "ranking", label: "Ranking", category: "data", description: "Scores and prioritizes items by relevance, quality, or other criteria." },
  { id: "search", label: "Search", category: "search", description: "Looks up records, names or resources by query in a specific corpus or registry." },
  { id: "web-search", label: "Web Search", category: "search", description: "Searches the public internet for information." },
  { id: "semantic-search", label: "Semantic Search", category: "search", description: "Retrieves results based on meaning rather than keyword matching." },
  { id: "document-search", label: "Document Search", category: "search", description: "Searches across document collections, PDFs, or knowledge bases." },
  { id: "knowledge-retrieval", label: "Knowledge Retrieval", category: "search", description: "Queries structured knowledge bases or performs retrieval-augmented generation." },
  { id: "citation", label: "Citation", category: "search", description: "Finds, formats, and verifies references and source attributions." },
  { id: "image-generation", label: "Image Generation", category: "media", description: "Creates images from text prompts or other inputs." },
  { id: "image-editing", label: "Image Editing", category: "media", description: "Modifies, enhances, or transforms existing images." },
  { id: "image-analysis", label: "Image Analysis", category: "media", description: "Extracts information, labels, or descriptions from images." },
  { id: "video-generation", label: "Video Generation", category: "media", description: "Creates video content from text, images, or other inputs." },
  { id: "video-analysis", label: "Video Analysis", category: "media", description: "Extracts information, scenes, or transcripts from video." },
  { id: "audio-transcription", label: "Audio Transcription", category: "media", description: "Converts spoken audio into text." },
  { id: "audio-generation", label: "Audio Generation", category: "media", description: "Produces speech, music, or sound effects from text or other inputs." },
  { id: "ocr", label: "OCR", category: "media", description: "Extracts text from images, scans, or documents via optical character recognition." },
  { id: "design", label: "Design", category: "media", description: "Creates UI mockups, graphics, layouts, or other visual design work." },
  { id: "3d-modeling", label: "3D Modeling", category: "media", description: "Generates or manipulates three-dimensional models and scenes." },
  { id: "chat", label: "Chat", category: "communication", description: "Engages in real-time conversational interaction with users or other agents." },
  { id: "email-drafting", label: "Email Drafting", category: "communication", description: "Composes, formats, and suggests email messages." },
  { id: "meeting-notes", label: "Meeting Notes", category: "communication", description: "Transcribes, summarizes, and extracts action items from meetings." },
  { id: "presentation", label: "Presentation", category: "communication", description: "Creates slides, pitch decks, and structured visual presentations." },
  { id: "tutoring", label: "Tutoring", category: "communication", description: "Provides educational instruction, explanations, and guided learning." },
  { id: "customer-support", label: "Customer Support", category: "communication", description: "Handles support queries, troubleshooting, and issue resolution." },
  { id: "negotiation", label: "Negotiation", category: "communication", description: "Facilitates structured dialogue toward agreement or compromise." },
  { id: "web-scraping", label: "Web Scraping", category: "automation", description: "Extracts structured data from web pages." },
  { id: "api-integration", label: "API Integration", category: "automation", description: "Connects to and orchestrates third-party APIs." },
  { id: "workflow-automation", label: "Workflow Automation", category: "automation", description: "Automates multi-step business or technical workflows." },
  { id: "scheduling", label: "Scheduling", category: "automation", description: "Manages time-based tasks, reminders, and calendar operations." },
  { id: "monitoring", label: "Monitoring", category: "automation", description: "Observes systems, services, or data streams and reports on status changes." },
  { id: "deployment", label: "Deployment", category: "automation", description: "Manages CI/CD pipelines, releases, and software deployments." },
  { id: "file-management", label: "File Management", category: "automation", description: "Organizes, converts, moves, and manages files and directories." },
  { id: "notification", label: "Notification", category: "automation", description: "Sends alerts, messages, and notifications across channels." },
  { id: "data-entry", label: "Data Entry", category: "automation", description: "Fills forms, inputs data, and automates manual entry tasks." },
  { id: "vulnerability-scanning", label: "Vulnerability Scanning", category: "security", description: "Assesses systems and code for security weaknesses." },
  { id: "compliance-checking", label: "Compliance Checking", category: "security", description: "Verifies adherence to policies, regulations, and standards." },
  { id: "threat-detection", label: "Threat Detection", category: "security", description: "Identifies potential security threats and suspicious activity." },
  { id: "access-control", label: "Access Control", category: "security", description: "Manages permissions, roles, and authentication policies." },
  { id: "encryption", label: "Encryption", category: "security", description: "Handles data encryption, decryption, and key management." },
];

export const CAPABILITY_VOCABULARY: CapabilityVocabulary = { categories: CAPABILITY_CATEGORIES, capabilities: CAPABILITIES };

// ── ranking ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** How a query term matched, strongest first. */
export type CapabilityMatch = "exact" | "prefix" | "word" | "substring" | "description" | "category";

export interface RankedCapability { capability: CapabilityDef; score: number; match: CapabilityMatch; uses: number }

export interface RankOptions {
  vocabulary?: CapabilityVocabulary;
  /** id → number of published agents declaring it; breaks ties toward terms other agents use. */
  usage?: Record<string, number>;
  /** Ids to leave out (already selected). */
  exclude?: readonly string[];
  limit?: number;
}

const TIER: Record<CapabilityMatch, number> = { exact: 100, prefix: 80, word: 60, substring: 40, category: 25, description: 15 };

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function termScore(term: string, c: CapabilityDef, categoryLabel: string): { score: number; match: CapabilityMatch } | null {
  const id = c.id; const label = c.label.toLowerCase();
  const names = [id, label, ...(c.aliases ?? [])];
  if (names.includes(term)) return { score: TIER.exact, match: "exact" };
  if (names.some((n) => n.startsWith(term))) return { score: TIER.prefix, match: "prefix" };
  if (names.some((n) => words(n).some((w) => w.startsWith(term)))) return { score: TIER.word, match: "word" };
  if (names.some((n) => n.includes(term))) return { score: TIER.substring, match: "substring" };
  if (words(categoryLabel).some((w) => w.startsWith(term))) return { score: TIER.category, match: "category" };
  if (words(c.description).some((w) => w.startsWith(term))) return { score: TIER.description, match: "description" };
  return null;
}

/**
 * Rank the vocabulary against a query, best first. Every term of the query must match somewhere; a capability scores
 * the sum of its terms, each tiered exact > prefix > word start > substring (id, label, aliases) > category >
 * description word. Ties go to more published uses, then the shorter id, then vocabulary order. An empty query
 * returns everything (not deprecated), most used first.
 */
export function rankCapabilities(query: string, opts: RankOptions = {}): RankedCapability[] {
  const vocab = opts.vocabulary ?? CAPABILITY_VOCABULARY;
  const usage = opts.usage ?? {};
  const exclude = new Set(opts.exclude ?? []);
  const catLabel = new Map(vocab.categories.map((c) => [c.id, c.label]));
  const q = query.trim().toLowerCase();
  const terms = q.split(/[\s,]+/).filter(Boolean);
  const out: (RankedCapability & { order: number })[] = [];
  vocab.capabilities.forEach((c, order) => {
    if (c.deprecated || exclude.has(c.id)) return;
    const uses = usage[c.id] ?? 0;
    if (!terms.length) { out.push({ capability: c, score: 0, match: "substring", uses, order }); return; }
    let score = 0; let best: CapabilityMatch = "description";
    if (terms.length > 1 && [c.id, c.label.toLowerCase()].some((n) => n === q || n === terms.join("-"))) { out.push({ capability: c, score: TIER.exact * terms.length, match: "exact", uses, order }); return; }
    for (const t of terms) {
      const m = termScore(t, c, catLabel.get(c.category) ?? "");
      if (!m) return;
      score += m.score;
      if (TIER[m.match] > TIER[best]) best = m.match;
    }
    out.push({ capability: c, score, match: best, uses, order });
  });
  out.sort((a, b) => b.score - a.score || b.uses - a.uses || a.capability.id.length - b.capability.id.length || a.order - b.order);
  return out.slice(0, opts.limit ?? out.length).map(({ order: _o, ...r }) => r);
}

/** Lowercase, hyphenated id from free text: "Weather Alerts" → "weather-alerts". */
export function toCapabilityId(text: string): string {
  return text.trim().toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return d[b.length];
}

/**
 * A vocabulary id a custom id is probably meant to be ("did you mean"), or null. Close spelling (edit distance ≤ 2,
 * scaled for short ids), or the same words in another order or with one word dropped.
 */
export function nearestCapability(id: string, vocabulary: CapabilityVocabulary = CAPABILITY_VOCABULARY): CapabilityDef | null {
  const target = toCapabilityId(id);
  if (!target) return null;
  const live = vocabulary.capabilities.filter((c) => !c.deprecated);
  if (live.some((c) => c.id === target || c.aliases?.includes(target))) return null;
  const tw = new Set(target.split("-"));
  let best: { c: CapabilityDef; d: number } | null = null;
  for (const c of live) {
    const limit = Math.min(2, Math.floor(c.id.length / 4));
    const d = editDistance(target, c.id);
    if (d <= limit && (!best || d < best.d)) best = { c, d };
  }
  if (best) return best.c;
  for (const c of live) {
    const cw = c.id.split("-");
    const shared = cw.filter((w) => tw.has(w)).length;
    if (cw.length > 1 && shared >= Math.max(cw.length, tw.size) - 1 && shared >= 1 && Math.abs(cw.length - tw.size) <= 1) return c;
  }
  return null;
}

// ── suggestions from an agent's own self-description ─────────────────────────────────────────────────────────────

export interface SuggestionSource { from: string; text: string }
export interface CapabilitySuggestionResult { id: string; score: number; from: string[] }

const STOP = new Set("agent agents agt demo who what when whom whose which how does do lets let a an and any are as at be by can for from get gets has in into is it its list of on or set the their this to use uses using via was with your you returns return given value values item items tool tools api endpoint endpoints request response".split(" "));

/** Crude stemmer: enough to make forecast/forecasting/forecasts and summarize/summarization meet. */
export function stem(w: string): string {
  for (const suf of ["ization", "isation", "ations", "ation", "ating", "ated", "ates", "ate", "ings", "ing", "ers", "er", "ies", "es", "ed", "ize", "ise", "s", "e"]) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return suf === "ies" ? w.slice(0, -3) + "y" : w.slice(0, -suf.length);
  }
  return w;
}

/** Split identifiers and prose into stemmed content words: get_forecast, getForecast, "Get the forecast" → [forecast]. */
export function contentWords(text: string): string[] {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

/**
 * Suggest vocabulary capabilities from what an agent says about itself (MCP tool names and descriptions, A2A skills).
 * Words are weighted by rarity across the vocabulary, so "forecast" (one capability) counts and "data" (six) barely
 * does: a shared name word scores 3 / (capabilities whose names contain it), a shared description word 1 / (descriptions
 * containing it). Each result lists the sources that support it, so the UI can show where a suggestion came from.
 * Precision over recall: a wrong suggestion costs the user an untick, a missing one only a search.
 */
export function suggestCapabilities(sources: readonly SuggestionSource[], opts: { vocabulary?: CapabilityVocabulary; limit?: number; minScore?: number } = {}): CapabilitySuggestionResult[] {
  const vocab = opts.vocabulary ?? CAPABILITY_VOCABULARY;
  const prepared = vocab.capabilities.filter((c) => !c.deprecated).map((c) => ({
    c,
    name: new Set(contentWords([c.id, c.label, ...(c.aliases ?? [])].join(" "))),
    desc: new Set(contentWords(c.description)),
  }));
  const nameDf = new Map<string, number>(); const descDf = new Map<string, number>();
  for (const p of prepared) { for (const w of p.name) nameDf.set(w, (nameDf.get(w) ?? 0) + 1); for (const w of p.desc) descDf.set(w, (descDf.get(w) ?? 0) + 1); }
  const acc = new Map<string, CapabilitySuggestionResult>();
  for (const s of sources) {
    const words = new Set(contentWords(s.text));
    for (const p of prepared) {
      let score = 0;
      for (const w of words) {
        if (p.name.has(w)) score += 3 / nameDf.get(w)!;
        else if (p.desc.has(w)) score += 1 / descDf.get(w)!;
      }
      if (score < 1) continue;
      const r = acc.get(p.c.id) ?? { id: p.c.id, score: 0, from: [] };
      r.score += score;
      if (!r.from.includes(s.from)) r.from.push(s.from);
      acc.set(p.c.id, r);
    }
  }
  return [...acc.values()].map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 })).filter((r) => r.score >= (opts.minScore ?? 2.5)).sort((a, b) => b.score - a.score || b.from.length - a.from.length).slice(0, opts.limit ?? 6);
}
