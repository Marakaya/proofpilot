import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filename), "..");
const registryFile = path.join(root, "skills/proofpilot/references/service-access.json");

// This registry is prose and source metadata. Validation never interprets setup
// examples as executable commands and never performs network or account access.
const sourceHosts = new Map([
  ["colosseum_copilot", ["colosseum.com", "docs.colosseum.com", "github.com"]],
  ["github", ["github.com", "docs.github.com"]],
  ["defillama", ["defillama.com", "api-docs.defillama.com"]],
  ["ethglobal_skills", ["github.com", "raw.githubusercontent.com"]],
  ["kaggle", ["www.kaggle.com", "github.com", "raw.githubusercontent.com"]],
  ["hugging_face", ["huggingface.co"]],
  ["openai", ["platform.openai.com", "developers.openai.com", "learn.chatgpt.com"]],
  ["anthropic", ["platform.claude.com", "support.claude.com"]],
  ["gemini", ["aistudio.google.com", "ai.google.dev"]],
  ["replit", ["replit.com", "docs.replit.com"]]
]);
const costClasses = new Set([
  "free_member_access", "free_public_and_account_api", "free_public_plus_paid_pro",
  "free_rate_limited_plus_x402", "public_research_account_access",
  "free_public_plus_compute_credits", "separate_usage_billed_api",
  "separate_prepaid_or_invoiced_api", "model_specific_free_tier_plus_usage_billing",
  "account_plan_and_usage", "account_terms_at_sign_in", "free_account_plus_premium_credits"
]);
const topKeys = new Set(["checked_at", "scope", "policy", "services"]);
const serviceKeys = new Set([
  "service_id", "mandatory", "how_to_get", "urls", "cost_class",
  "free_scope", "paid_scope", "limitations", "checked_at"
]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = value => typeof value === "string" && value.trim().length > 0;
const isTextList = value => Array.isArray(value) && value.length > 0 && value.every(isText);
function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPrimarySource(value, serviceId) {
  if (!isText(value) || value.trim() !== value || !value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search) return false;
    if (!sourceHosts.get(serviceId)?.includes(url.hostname)) return false;
    if (serviceId === "colosseum_copilot" && url.hostname === "github.com") return url.pathname.startsWith("/ColosseumOrg/colosseum-copilot/") || url.pathname === "/ColosseumOrg/colosseum-copilot";
    if (serviceId === "ethglobal_skills") return url.pathname.startsWith("/ethglobal-skills/repo/") || url.pathname === "/ethglobal-skills/repo";
    if (serviceId === "kaggle" && ["github.com", "raw.githubusercontent.com"].includes(url.hostname)) return url.pathname.startsWith("/Kaggle/kaggle-cli/") || url.pathname === "/Kaggle/kaggle-cli";
    return true;
  } catch {
    return false;
  }
}

export function validateServiceAccess(data) {
  const errors = [];
  const report = (location, message) => errors.push(`${location}: ${message}`);
  if (!isObject(data)) return ["service-access: expected an object"];
  if (Object.keys(data).some(key => !topKeys.has(key))) report("service-access", "unexpected field");
  if (!isCalendarDate(data.checked_at)) report("checked_at", "expected a real YYYY-MM-DD date");
  for (const key of ["scope", "policy"]) if (!isText(data[key])) report(key, "expected non-empty text");
  if (!Array.isArray(data.services)) return [...errors, "services: expected an array"];
  const seen = new Set();
  data.services.forEach((service, index) => {
    const location = `services[${index}]`;
    if (!isObject(service)) return report(location, "expected an object");
    if (Object.keys(service).some(key => !serviceKeys.has(key))) report(location, "unexpected field");
    if (!sourceHosts.has(service.service_id)) report(`${location}.service_id`, "unknown service");
    else if (seen.has(service.service_id)) report(`${location}.service_id`, "duplicate service");
    seen.add(service.service_id);
    if (service.mandatory !== (service.service_id === "colosseum_copilot")) report(`${location}.mandatory`, "only Colosseum must be mandatory; optional services must be false");
    for (const key of ["free_scope", "paid_scope"]) if (!isText(service[key])) report(`${location}.${key}`, "expected non-empty cost explanation");
    for (const key of ["how_to_get", "limitations"]) if (!isTextList(service[key])) report(`${location}.${key}`, "expected a non-empty list of text");
    if (!costClasses.has(service.cost_class)) report(`${location}.cost_class`, "unknown or missing cost category");
    if (!isCalendarDate(service.checked_at)) report(`${location}.checked_at`, "expected a real YYYY-MM-DD date");
    else if (isCalendarDate(data.checked_at) && service.checked_at > data.checked_at) report(`${location}.checked_at`, "service review cannot be later than registry review");
    if (!Array.isArray(service.urls) || service.urls.length === 0) report(`${location}.urls`, "expected primary source URLs");
    else service.urls.forEach((url, sourceIndex) => {
      if (!isPrimarySource(url, service.service_id)) report(`${location}.urls[${sourceIndex}]`, "expected an HTTPS primary source without credentials, query or custom port");
    });
  });
  if ([...sourceHosts.keys()].some(id => !seen.has(id))) report("services", "a required registry service is missing");
  return errors;
}

export function runServiceAccessTests() {
  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  let cases = 0;
  const expect = (name, fixture, valid) => {
    const before = structuredClone(fixture);
    const errors = validateServiceAccess(fixture);
    assert.equal(errors.length === 0, valid, `${name}: ${errors.join("; ") || "unexpected acceptance"}`);
    assert.deepEqual(fixture, before, `${name}: validation must not mutate its input`);
    cases += 1;
    return errors;
  };
  expect("checked registry", registry, true);
  const mutations = [
    ["Colosseum cannot become optional", d => { d.services[0].mandatory = false; }],
    ["optional service cannot become mandatory", d => { d.services[1].mandatory = true; }],
    ["boolean strings cannot grant mandatory status", d => { d.services[0].mandatory = "true"; }],
    ["foundation entry cannot disappear", d => { d.services.shift(); }],
    ["duplicate service cannot replace omitted coverage", d => { d.services[1] = structuredClone(d.services[0]); }],
    ["missing free scope is rejected", d => { delete d.services[0].free_scope; }],
    ["blank paid scope is rejected", d => { d.services[1].paid_scope = "  "; }],
    ["missing cost class is rejected", d => { delete d.services[1].cost_class; }],
    ["unknown cost class is rejected", d => { d.services[1].cost_class = "always_free"; }],
    ["missing acquisition steps are rejected", d => { delete d.services[0].how_to_get; }],
    ["empty acquisition steps are rejected", d => { d.services[0].how_to_get = []; }],
    ["structured commands cannot replace prose steps", d => { d.services[0].how_to_get = [{ command: "run something" }]; }],
    ["missing primary URLs are rejected", d => { delete d.services[0].urls; }],
    ["HTTP is unsafe for source links", d => { d.services[0].urls[0] = "http://colosseum.com/arena/copilot"; }],
    ["credential-bearing URLs are rejected", d => { d.services[0].urls[0] = "https://secret@colosseum.com/arena/copilot"; }],
    ["credential query URLs are rejected", d => { d.services[0].urls[0] = "https://colosseum.com/arena/copilot?token=secret"; }],
    ["host suffix phishing is rejected", d => { d.services[0].urls[0] = "https://colosseum.com.example.org/arena/copilot"; }],
    ["nonofficial GitHub repository is rejected", d => { d.services.find(s => s.service_id === "ethglobal_skills").urls[0] = "https://github.com/another-owner/another-repo"; }],
    ["invalid registry calendar date is rejected", d => { d.checked_at = "2026-02-30"; }],
    ["missing service date is rejected", d => { delete d.services[0].checked_at; }],
    ["invalid service calendar date is rejected", d => { d.services[0].checked_at = "2026-02-30"; }],
    ["service cannot claim later review than registry", d => { d.services[0].checked_at = "2999-01-01"; }],
    ["unknown configuration fields cannot hold secrets", d => { d.services[0].api_key = "sentinel-secret-value"; }]
  ];
  for (const [name, mutate] of mutations) {
    const fixture = structuredClone(registry);
    mutate(fixture);
    const errors = expect(name, fixture, false);
    assert.ok(!errors.join(" ").includes("sentinel-secret-value"), "error messages must not print untrusted values");
  }
  expect("null input", null, false);
  expect("services must be structured entries", { ...registry, services: [null] }, false);
  const prose = structuredClone(registry);
  prose.services[0].how_to_get.push("Prose examples may contain shell notation such as $(placeholder); validation treats this as inert text.");
  expect("prose remains data", prose, true);
  return { cases, services: registry.services.length };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(filename)) {
  const summary = runServiceAccessTests();
  console.log(`Service access validation passed: ${summary.cases} cases across ${summary.services} services. No credentials or accounts accessed.`);
}
