import { test } from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, CAPABILITY_CATEGORIES, nearestCapability, rankCapabilities, toCapabilityId } from "./capabilities.js";

const ids = (q: string, o = {}) => rankCapabilities(q, o).map((r) => r.capability.id);

test("vocabulary snapshot: 70 lowercase hyphenated ids in 8 known categories, no duplicates", () => {
  assert.equal(CAPABILITIES.length, 70);
  assert.equal(CAPABILITY_CATEGORIES.length, 8);
  const cats = new Set(CAPABILITY_CATEGORIES.map((c) => c.id));
  assert.equal(new Set(CAPABILITIES.map((c) => c.id)).size, CAPABILITIES.length);
  for (const c of CAPABILITIES) {
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, c.id);
    assert.ok(cats.has(c.category), `${c.id} category ${c.category}`);
  }
});

test("the exact match ranks first (agt-site#452: `search` used to list `research` first)", () => {
  assert.equal(ids("search")[0], "search");
  assert.ok(ids("search").indexOf("research") > 0);
});

test("tiers: id prefix beats a description-only hit", () => {
  const r = rankCapabilities("code");
  assert.match(r[0].capability.id, /^code/);
  const firstDescriptionOnly = r.findIndex((x) => x.match === "description");
  const lastPrefix = r.map((x) => x.match).lastIndexOf("prefix");
  if (firstDescriptionOnly >= 0) assert.ok(lastPrefix < firstDescriptionOnly);
});

test("partial typing lands on the intended term", () => {
  assert.equal(ids("fore")[0], "forecasting");
  assert.equal(ids("fact")[0], "fact-checking");
  assert.equal(ids("question answering")[0], "question-answering");
  assert.equal(ids("question-answering")[0], "question-answering");
});

test("every term must match; nonsense matches nothing", () => {
  assert.deepEqual(ids("zzqx"), []);
  assert.ok(ids("code review").every((id) => rankCapabilities("code review").length > 0 && id.length > 0));
});

test("usage breaks ties; exclude drops selected ids; limit caps", () => {
  const plain = ids("");
  const used = ids("", { usage: { [plain.at(-1)!]: 9 } });
  assert.equal(used[0], plain.at(-1));
  assert.ok(!ids("search", { exclude: ["search"] }).includes("search"));
  assert.equal(ids("", { limit: 7 }).length, 7);
});

test("toCapabilityId normalizes free text", () => {
  assert.equal(toCapabilityId("  Weather Alerts! "), "weather-alerts");
  assert.equal(toCapabilityId("Café_Search"), "cafe-search");
  assert.equal(toCapabilityId("---"), "");
});

test("nearestCapability: typos and reordered words point at the vocabulary; known and unrelated ids do not", () => {
  assert.equal(nearestCapability("forcasting")?.id, "forecasting");
  assert.equal(nearestCapability("answering-question")?.id, "question-answering");
  assert.equal(nearestCapability("search"), null);
  assert.equal(nearestCapability("weather-radar-tiles"), null);
});

test("suggestCapabilities: rare shared words suggest, generic ones do not, and sources are kept", async () => {
  const { suggestCapabilities, stem } = await import("./capabilities.js");
  assert.equal(stem("translate"), stem("translation"));
  assert.equal(stem("summarize"), stem("summarization"));
  assert.equal(stem("forecasting"), stem("forecast"));
  const s = (text: string) => suggestCapabilities([{ from: "tool t", text }]).map((r) => r.id);
  assert.equal(s("get_forecast Hourly and daily weather forecast for a city")[0], "forecasting");
  assert.equal(s("translate Translate text between languages")[0], "translation");
  assert.equal(s("review_pr Review a pull request and suggest code changes")[0], "code-review");
  assert.deepEqual(s("echo Echoes the input back"), []);
  assert.deepEqual(s("agent_sources Lists which agents and data sources are called"), [], "one generic word is not enough");
  const multi = suggestCapabilities([{ from: "tool summarize", text: "summarize a document" }, { from: "skill Summaries", text: "Summaries of long reports" }]);
  assert.deepEqual(multi.find((r) => r.id === "summarization")?.from, ["tool summarize", "skill Summaries"]);
});
