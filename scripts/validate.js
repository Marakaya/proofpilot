import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import { renderToolDocs } from "./tool-docs.js";
import { validateServiceAccess } from "./test-service-access.js";
import { isDate, validateFreshnessSemantics } from "./freshness.js";
import { isDateTime, validateResponseSemantics } from "../skills/proofpilot/scripts/validate-response.js";
import { runEventScore } from "../skills/proofpilot/scripts/event-score.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skillDir = path.join(root, "skills", "proofpilot");
const referencesDir = path.join(skillDir, "references");

const requiredFiles = [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/workflow.md",
  "docs/runtime.md",
  "docs/credential-model.md",
  "docs/included-tools.md",
  "examples/requests.md",
  "examples/responses/unknown-idea.json",
  "examples/evals/cases.json",
  "examples/evals/behavioral-cases.json",
  "docs/evaluation.md",
  "scripts/eval-behavior.js",
  "skills/proofpilot/SKILL.md",
  "skills/proofpilot/agents/openai.yaml",
  "skills/proofpilot/references/routing.md",
  "skills/proofpilot/references/discover.md",
  "skills/proofpilot/references/validate.md",
  "skills/proofpilot/references/plan.md",
  "skills/proofpilot/references/review.md",
  "skills/proofpilot/references/event-assessment.md",
  "skills/proofpilot/references/event-intake.md",
  "skills/proofpilot/references/event-profiles.json",
  "skills/proofpilot/scripts/event-score.js",
  "scripts/test-event-score.js",
  "skills/proofpilot/references/submit.md",
  "skills/proofpilot/references/evidence.md",
  "skills/proofpilot/references/freshness.md",
  "scripts/freshness.js",
  "skills/proofpilot/references/decisions.md",
  "skills/proofpilot/references/quality.md",
  "skills/proofpilot/references/quality-review.md",
  "skills/proofpilot/scripts/quality.js",
  "skills/proofpilot/scripts/package.json",
  "skills/proofpilot/references/product-market-fit.md",
  "skills/proofpilot/references/ai-product-validation.md",
  "skills/proofpilot/references/safety.md",
  "skills/proofpilot/references/accelerator-programs.json",
  "skills/proofpilot/references/accelerator-checklist.json",
  "skills/proofpilot/references/accelerators.md",
  "skills/proofpilot/references/decision-lenses.json",
  "skills/proofpilot/references/honest-evaluation.md",
  "skills/proofpilot/references/judgment-policy.json",
  "skills/proofpilot/references/presentation-checklist.json",
  "skills/proofpilot/references/presentation-decks.json",
  "skills/proofpilot/references/presentations.md",
  "skills/proofpilot/references/solana-new.md",
  "skills/proofpilot/references/source-orchestration.md",
  "skills/proofpilot/references/source-playbooks.json",
  "skills/proofpilot/references/onboarding.md",
  "skills/proofpilot/references/service-access.json",
  "skills/proofpilot/scripts/setup.js",
  "skills/proofpilot/scripts/colosseum-read.js",
  "skills/proofpilot/scripts/discover-sources.js",
  "skills/proofpilot/scripts/validate-response.js"
];

const registrySpecs = [
  ["taxonomy.json", "taxonomy.schema.json"],
  ["credential-registry.json", "credential-registry.schema.json"],
  ["source-registry.json", "source-registry.schema.json"],
  ["tool-registry.json", "tool-registry.schema.json"],
  ["rubrics.json", "rubrics.schema.json"]
];

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function assertUnique(items, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      fail(`Duplicate ${label} id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

function assertReferences(values, allowed, label) {
  for (const value of values) {
    if (!allowed.has(value)) {
      fail(`Unknown ${label}: ${value}`);
    }
  }
}

function formatAjvErrors(errors) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat("date", isDate);
  ajv.addFormat("date-time", isDateTime);
  ajv.addFormat("uri", (value) => {
    try { return value.startsWith("https://") && new URL(value).protocol === "https:"; }
    catch { return false; }
  });
  return ajv;
}

export function createResponseValidator({
  schema = readJson("skills/proofpilot/references/response.schema.json"),
  rubrics = readJson("skills/proofpilot/references/rubrics.json"),
  sources = readJson("skills/proofpilot/references/source-registry.json"),
  tools = readJson("skills/proofpilot/references/tool-registry.json"),
  credentials = readJson("skills/proofpilot/references/credential-registry.json")
} = {}) {
  const validate = createAjv().compile(schema);
  return (response) => {
    if (!validate(response)) return [formatAjvErrors(validate.errors)];
    return validateResponseSemantics(response, { rubrics, sources, tools, credentials });
  };
}

export function validateResponseFile(filePath) {
  const fullPath = path.resolve(filePath);
  const response = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const errors = createResponseValidator()(response);
  if (errors.length) fail(`${fullPath} failed response validation: ${errors.join("; ")}`);
  return response;
}

export function validateRepository() {
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(root, file))) {
      fail(`Missing required file: ${file}`);
    }
  }

  const ajv = createAjv();

  for (const [dataFile, schemaFile] of registrySpecs) {
    const data = readJson(path.join("skills", "proofpilot", "references", dataFile));
    const schema = readJson(path.join("skills", "proofpilot", "references", schemaFile));
    const validate = ajv.compile(schema);
    if (!validate(data)) {
      fail(`${dataFile} failed schema validation: ${formatAjvErrors(validate.errors)}`);
    }
  }

  const responseSchema = readJson("skills/proofpilot/references/response.schema.json");
  // Event profiles use fixed 100-point weights, independently of venture rubrics.
  runEventScore(["list"]);

  const taxonomy = readJson("skills/proofpilot/references/taxonomy.json");
  const credentials = readJson("skills/proofpilot/references/credential-registry.json");
  const sources = readJson("skills/proofpilot/references/source-registry.json");
  const tools = readJson("skills/proofpilot/references/tool-registry.json");
  const rubrics = readJson("skills/proofpilot/references/rubrics.json");
  const evalCases = readJson("examples/evals/cases.json");
  const packageManifest = readJson("package.json");
  const acceleratorPrograms = readJson("skills/proofpilot/references/accelerator-programs.json");
  const acceleratorChecklist = readJson("skills/proofpilot/references/accelerator-checklist.json");
  const decisionLenses = readJson("skills/proofpilot/references/decision-lenses.json");
  const judgmentPolicy = readJson("skills/proofpilot/references/judgment-policy.json");
  const presentationChecklist = readJson("skills/proofpilot/references/presentation-checklist.json");
  const presentationDecks = readJson("skills/proofpilot/references/presentation-decks.json");
  const sourcePlaybooks = readJson("skills/proofpilot/references/source-playbooks.json");
  const serviceAccess = readJson("skills/proofpilot/references/service-access.json");
  const serviceErrors = validateServiceAccess(serviceAccess);
  if (serviceErrors.length) fail(serviceErrors.join("; "));

  for (const [entries, kind] of [[tools.tools, "tool"], [sources.sources, "source"], [acceleratorPrograms.programs, "program"]]) {
    for (const entry of entries) {
      const errors = validateFreshnessSemantics(entry, { kind });
      if (errors.length) fail(errors.join("; "));
    }
  }

  if (packageManifest.version !== taxonomy.version) {
    fail(`package.json version ${packageManifest.version} does not match taxonomy version ${taxonomy.version}`);
  }
  if (responseSchema.properties.version.const !== taxonomy.version) {
    fail("response.schema.json version does not match the taxonomy version");
  }
  if (!Array.isArray(judgmentPolicy.non_negotiables) || judgmentPolicy.non_negotiables.length < 3) {
    fail("judgment-policy.json must define at least three non-negotiable rules");
  }

  const stages = new Set(taxonomy.stages.map(({ id }) => id));
  const domains = new Set(taxonomy.domains.map(({ id }) => id));
  const ventureTypes = new Set(taxonomy.venture_types.map(({ id }) => id));
  const programContexts = new Set(taxonomy.program_contexts.map(({ id }) => id));
  const modes = new Set(taxonomy.modes.map(({ id }) => id));
  const sensitivities = new Set(taxonomy.sensitivity_classes.map(({ id }) => id));
  const credentialClasses = new Set(credentials.credential_classes.map(({ id }) => id));
  const permissionClasses = new Set(credentials.permission_classes.map(({ id }) => id));

  for (const [items, label] of [
    [taxonomy.modes, "mode"],
    [taxonomy.stages, "stage"],
    [taxonomy.domains, "domain"],
    [taxonomy.venture_types, "venture type"],
    [taxonomy.program_contexts, "program context"],
    [taxonomy.sensitivity_classes, "sensitivity class"],
    [credentials.credential_classes, "credential class"],
    [credentials.permission_classes, "permission class"],
    [sources.sources, "source"],
    [tools.tools, "tool"],
    [rubrics.rubrics, "rubric"],
    [evalCases.cases, "eval case"],
    [acceleratorPrograms.programs, "accelerator program"],
    [decisionLenses.lenses, "decision lens"],
    [presentationDecks.deck_types, "presentation deck"],
    [sourcePlaybooks.playbooks, "source playbook"]
  ]) {
    assertUnique(items, label);
  }

  const stageOrders = taxonomy.stages.map(({ order }) => order);
  if (new Set(stageOrders).size !== stageOrders.length) {
    fail("Stage order values must be unique");
  }

  for (const stage of taxonomy.stages) {
    const workflowPath = path.join(referencesDir, stage.workflow_ref);
    if (!fs.existsSync(workflowPath)) {
      fail(`Missing workflow for stage ${stage.id}: ${stage.workflow_ref}`);
    }
  }

  for (const source of sources.sources) {
    assertReferences(source.stages, stages, `stage in source ${source.id}`);
    assertReferences(source.domains, domains, `domain in source ${source.id}`);
    assertReferences(source.program_contexts, programContexts, `program context in source ${source.id}`);
    assertReferences([source.credential_class], credentialClasses, `credential class in source ${source.id}`);
    if (source.status === "available_public" && (!source.official_url || !source.last_verified_at)) {
      fail(`Public source ${source.id} requires an official URL and verification date`);
    }
  }

  for (const tool of tools.tools) {
    assertReferences(tool.stages, stages, `stage in tool ${tool.id}`);
    assertReferences(tool.domains, domains, `domain in tool ${tool.id}`);
    assertReferences(tool.program_contexts, programContexts, `program context in tool ${tool.id}`);
    assertUnique(tool.capabilities, `capability in tool ${tool.id}`);
    for (const capability of tool.capabilities) {
      assertReferences([capability.credential_class], credentialClasses, `credential class in ${tool.id}.${capability.id}`);
      assertReferences([capability.permission_class], permissionClasses, `permission class in ${tool.id}.${capability.id}`);
      if (
        ["final_submit", "wallet_or_paid_action"].includes(capability.permission_class) &&
        capability.status === "available_public"
      ) {
        fail(`High-risk capability ${tool.id}.${capability.id} cannot be available_public`);
      }
      if (capability.credential_class === "wallet_session" && capability.status !== "deferred") {
        fail(`Wallet capability ${tool.id}.${capability.id} must remain deferred`);
      }
    }
    if (tool.capabilities.some(({ status }) => status === "available_public") && !tool.last_verified_at) {
      fail(`Tool ${tool.id} exposes public capability without a verification date`);
    }
  }

  for (const rubric of rubrics.rubrics) {
    assertReferences(rubric.applies_to_stages, stages, `stage in rubric ${rubric.id}`);
    assertUnique(rubric.dimensions, `dimension in rubric ${rubric.id}`);
    const weight = rubric.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
    if (Math.abs(weight - 1) > 1e-9) {
      fail(`Rubric ${rubric.id} weights must sum to 1; received ${weight}`);
    }
  }

  for (const testCase of evalCases.cases) {
    assertReferences([testCase.expected.mode], modes, `mode in eval ${testCase.id}`);
    assertReferences(testCase.expected.stages, stages, `stage in eval ${testCase.id}`);
    assertReferences(testCase.expected.domains, domains, `domain in eval ${testCase.id}`);
    assertReferences([testCase.expected.venture_type], ventureTypes, `venture type in eval ${testCase.id}`);
    assertReferences([testCase.expected.program_context], programContexts, `program context in eval ${testCase.id}`);
    assertReferences([testCase.expected.sensitivity], sensitivities, `sensitivity in eval ${testCase.id}`);
  }

  for (const program of acceleratorPrograms.programs) {
    for (const key of ["official_url", "apply_url"]) {
      if (program[key] && !program[key].startsWith("https://")) {
        fail(`Accelerator ${program.id} has an invalid ${key}`);
      }
    }
  }

  for (const playbook of sourcePlaybooks.playbooks) {
    assertReferences(playbook.stages, stages, `stage in source playbook ${playbook.id}`);
    if (!fs.existsSync(path.join(referencesDir, playbook.reference))) {
      fail(`Source playbook ${playbook.id} references missing file ${playbook.reference}`);
    }
  }

  for (const [checklist, label] of [
    [acceleratorChecklist.accelerator_readiness_rubric, "accelerator checklist"],
    [presentationChecklist.presentation_rubric, "presentation checklist"]
  ]) {
    if (!checklist || !Array.isArray(checklist.dimensions)) {
      fail(`Missing dimensions in ${label}`);
    }
    assertUnique(checklist.dimensions, label);
  }

  const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  const referenceLinks = [...skill.matchAll(/\]\(references\/([^)]+)\)/g)].map((match) => match[1]);
  for (const link of referenceLinks) {
    if (!fs.existsSync(path.join(referencesDir, link))) {
      fail(`SKILL.md references a missing file: references/${link}`);
    }
  }

  const agentMetadata = fs.readFileSync(path.join(skillDir, "agents", "openai.yaml"), "utf8");
  if (!agentMetadata.includes("$proofpilot")) {
    fail("agents/openai.yaml default prompt must explicitly mention $proofpilot");
  }

  const validateResponse = createResponseValidator({ schema: responseSchema, rubrics, sources });
  const responseDir = path.join(root, "examples", "responses");
  for (const filename of fs.readdirSync(responseDir).filter((name) => name.endsWith(".json"))) {
    const response = readJson(path.join("examples", "responses", filename));
    const errors = validateResponse(response);
    if (errors.length) fail(`${filename} failed response validation: ${errors.join("; ")}`);
  }

  const expectedToolDocs = renderToolDocs({ sources: sources.sources, tools: tools.tools });
  const actualToolDocs = fs.readFileSync(path.join(root, "docs", "included-tools.md"), "utf8");
  if (actualToolDocs !== expectedToolDocs) {
    fail("docs/included-tools.md is stale; run npm run generate:docs");
  }

  return {
    modes: taxonomy.modes.length,
    stages: taxonomy.stages.length,
    domains: taxonomy.domains.length,
    sources: sources.sources.length,
    tools: tools.tools.length,
    capabilities: tools.tools.reduce((count, tool) => count + tool.capabilities.length, 0),
    rubrics: rubrics.rubrics.length,
    evalCases: evalCases.cases.length
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const summary = validateRepository();
  console.log(
    `ProofPilot validation passed: ${summary.stages} stages, ${summary.sources} sources, ` +
      `${summary.tools} tools, ${summary.capabilities} capabilities, ${summary.rubrics} rubrics, ` +
      `${summary.evalCases} eval cases.`
  );
}
