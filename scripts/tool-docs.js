const categoryLabels = {
  source_and_connector: "Sources And Connectors",
  founder_framework: "Founder Frameworks",
  hackathon_platform: "Hackathon Platforms",
  data_platform: "Data Platforms",
  community_platform: "Community Platforms",
  ai_and_data: "AI And Data",
  llm_provider: "AI Providers",
  build_platform: "Build Platforms",
  deployment: "Deployment",
  cloud_platform: "Cloud Platforms",
  web3_scaffold: "Web3 Scaffolds",
  web3_intelligence: "Web3 Intelligence",
  web3_action: "Web3 Action Tools",
  security: "Security"
};

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function capabilitySummary(capabilities) {
  return capabilities
    .map(
      ({ id, status, credential_class: credential, permission_class: permission }) =>
        `\`${id}\`: ${status}; ${credential}; ${permission}`
    )
    .join("<br>");
}

export function renderToolDocs({ sources, tools }) {
  const lines = [
    "# Included Tools",
    "",
    "> Generated from the ProofPilot source and tool registries. Run `npm run generate:docs` after registry changes.",
    "",
    "ProofPilot distinguishes public references from connector specifications and implemented integrations. A listed tool is not automatically an active API connector.",
    "",
    "## Status Meanings",
    "",
    "| Status | Meaning |",
    "|---|---|",
    "| `available_public` | The agent can use current public material without a secret. |",
    "| `connector_spec` | The access model is documented, but ProofPilot does not ship a live adapter yet. |",
    "| `implemented` | A tested runtime adapter ships with ProofPilot. |",
    "| `catalogued` | Useful candidate that must be verified before runtime use. |",
    "| `deferred` | Intentionally disabled pending permission, security, cost, or product controls. |",
    "| `deprecated` | Retained only for migration or historical context. |",
    "",
    "## Evidence Sources",
    "",
    "| Source | Access | Status | Used For |",
    "|---|---|---|---|"
  ];

  for (const source of sources) {
    const label = source.official_url ? `[${source.label}](${source.official_url})` : source.label;
    lines.push(
      `| ${escapeCell(label)} | ${escapeCell(source.access)} | \`${source.status}\` | ${escapeCell(source.evidence_use)} |`
    );
  }

  const grouped = new Map();
  for (const tool of tools) {
    const categoryTools = grouped.get(tool.category) || [];
    categoryTools.push(tool);
    grouped.set(tool.category, categoryTools);
  }
  for (const [category, label] of Object.entries(categoryLabels)) {
    const categoryTools = grouped.get(category);
    if (!categoryTools?.length) continue;

    lines.push("", `## ${label}`, "", "| Tool | Used For | Capabilities | Decision |", "|---|---|---|---|");
    for (const tool of categoryTools) {
      lines.push(
        `| [${escapeCell(tool.label)}](${tool.official_url}) | ${escapeCell(tool.use_for)} | ${capabilitySummary(tool.capabilities)} | ${escapeCell(tool.decision)} |`
      );
    }
  }

  lines.push(
    "",
    "## Safety Boundary",
    "",
    "ProofPilot never asks for a private key, seed phrase, mnemonic, or raw secret in chat. Wallet, paid, deployment, resource-creation, and final-submission capabilities remain deferred until a specific action receives explicit approval and the runtime can enforce scope, limits, and audit logs.",
    ""
  );

  return lines.join("\n");
}
