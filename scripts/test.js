import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateRepository } from "./validate.js";
import { runResponseTests } from "./test-response.js";
import { runBehaviorCliTests } from "./test-eval-behavior.js";
import { runDiscoveryCredentialTests } from "./test-discovery-credentials.js";
import { runDependencyInstallTests } from "./test-dependency-install.js";
import { runSolanaDiscoveryTests } from "./test-solana-discovery.js";
import { runFreshnessTests } from "./test-freshness.js";
import { runSetupTests } from "./test-setup.js";
import { runInstallOnboardingTests } from "./test-install-onboarding.js";
import { runColosseumReadTests } from "./test-colosseum-read.js";
import { runColosseumV2MigrationTests } from "./test-colosseum-v2.js";
import { runServiceAccessTests } from "./test-service-access.js";
import { runQualityTests } from "./test-quality.js";
import { runEventScoreTests } from "./test-event-score.js";
import { runSupportPolicyTests } from "./test-support-policy.js";
import { runInstallSafetyTests } from "./test-install-safety.js";
import { runHelperExportRegressionTests } from "./test-helper-export-regressions.js";
import { runNodeRuntimeTests } from "./test-node-runtime.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "scripts", "cli.js");
const profileValidator = path.join(root, "scripts", "validate-install.js");

function runCli(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== expectedStatus) {
    throw new Error(
      `CLI ${args.join(" ")} exited ${result.status}; expected ${expectedStatus}. ` +
        `${result.stderr || result.stdout}`
    );
  }
  return result;
}

const summary = validateRepository();
const responseTests = runResponseTests();
const behaviorCliTests = runBehaviorCliTests();
const discoveryCredentialTests = runDiscoveryCredentialTests();
const solanaDiscoveryTests = runSolanaDiscoveryTests();
const dependencyInstallTests = runDependencyInstallTests();
const freshnessTests = runFreshnessTests();
const setupTests = await runSetupTests();
const installOnboardingTests = runInstallOnboardingTests();
const colosseumReadTests = await runColosseumReadTests();
const colosseumV2Tests = await runColosseumV2MigrationTests();
const serviceAccessTests = runServiceAccessTests();
const qualityTests = runQualityTests();
const eventScoreTests = runEventScoreTests();
const supportPolicyTests = runSupportPolicyTests();
const installSafetyTests = runInstallSafetyTests();
const helperExportRegressionTests = runHelperExportRegressionTests();
const nodeRuntimeTests = runNodeRuntimeTests();
runCli(["event", "list"]);
runCli(["event", "check"], 1);
runCli(["validate-response", "examples/responses/evaluator-partial-evidence.json"]);
runCli(["validate-response"], 1);
const inspectResult = runCli(["inspect", "--json"]);
const manifest = JSON.parse(inspectResult.stdout);

if (manifest.version !== "0.3.0" || manifest.tools !== summary.tools) {
  throw new Error("CLI inspect output does not match the validated registries");
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proofpilot-test-"));
const destination = path.join(temporaryRoot, "proofpilot");

try {
  runCli(["install", "--target", "codex", "--dir", destination, "--core-only"]);
  for (const relativePath of [
    "SKILL.md",
    "agents/openai.yaml",
    "references/taxonomy.json",
    "references/response.schema.json"
  ]) {
    if (!fs.existsSync(path.join(destination, relativePath))) {
      throw new Error(`Installed skill is missing ${relativePath}`);
    }
  }

  runCli(["install", "--target", "codex", "--dir", destination, "--core-only"]);
  fs.appendFileSync(path.join(destination, "SKILL.md"), "\nUser customization.\n");
  const overwriteResult = runCli(
    ["install", "--target", "codex", "--dir", destination, "--core-only"],
    1
  );
  if (!overwriteResult.stderr.includes("different files")) {
    throw new Error("CLI install did not explain how to handle an existing destination");
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

const profileResult = spawnSync(process.execPath, [profileValidator], {
  cwd: root,
  encoding: "utf8"
});
if (profileResult.status !== 0) {
  throw new Error(`Optional profile validation failed: ${profileResult.stderr || profileResult.stdout}`);
}

console.log(
  `ProofPilot tests passed: ${summary.tools} tools, ${summary.capabilities} capabilities, ` +
    `${dependencyInstallTests.cases} dependency installation tests, ${summary.rubrics} rubrics, ${summary.evalCases} routing contracts, ${responseTests.cases} response tests, ${behaviorCliTests.cases} eval CLI tests, ${discoveryCredentialTests.scenarios} credential scenarios, ${solanaDiscoveryTests.cases} Solana discovery scenarios, ${freshnessTests.cases} freshness tests, ${setupTests.cases} setup tests, ${installOnboardingTests.cases} onboarding install scenarios, ${colosseumReadTests.cases} Colosseum read tests, ${colosseumV2Tests.cases} V2 migration tests, ${serviceAccessTests.cases} service-access tests, ${qualityTests.cases} quality workflow tests, ${eventScoreTests.cases} event score tests, ${supportPolicyTests.cases} support policy tests, ${installSafetyTests.cases} installation safety tests, ${helperExportRegressionTests.cases} helper/export regression tests, ${nodeRuntimeTests.cases} Node runtime tests.`
);
