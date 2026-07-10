import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToolDocs } from "./tool-docs.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const references = path.join(root, "skills", "proofpilot", "references");
const sources = JSON.parse(fs.readFileSync(path.join(references, "source-registry.json"), "utf8"));
const tools = JSON.parse(fs.readFileSync(path.join(references, "tool-registry.json"), "utf8"));
const output = path.join(root, "docs", "included-tools.md");

fs.writeFileSync(output, renderToolDocs({ sources: sources.sources, tools: tools.tools }));
console.log(`Generated ${path.relative(root, output)}`);
