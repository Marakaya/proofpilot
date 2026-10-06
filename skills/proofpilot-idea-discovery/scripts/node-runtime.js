// Keep the declared package and official connection-helper runtime requirements
// explicit before installation or account operations can have side effects.
export function nodeRuntimeDiagnostic({ version = process.versions.node, platform = process.platform, arch = process.arch } = {}) {
  if (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) && Number(version.split(".")[0]) >= 20) return null;
  const compatibility = platform === "darwin" && arch === "x64" ?
    " For an Intel Mac on macOS Catalina 10.15, use the official Node.js 20 darwin-x64 distribution; Node.js 22 requires macOS 11. See references/installation.md#macos-catalina-intel-with-node-18." : "";
  return `ProofPilot and the official Colosseum connection helper require Node.js 20 or later; this process is running Node.js ${version}.${compatibility} Run every install/setup command with the absolute path to the compatible Node executable; changing Node in another terminal does not change an already running agent.`;
}

export function requireNodeRuntime() {
  const diagnostic = nodeRuntimeDiagnostic();
  if (!diagnostic) return;
  const error = new Error(diagnostic);
  error.code = "ENODERUNTIME";
  throw error;
}
