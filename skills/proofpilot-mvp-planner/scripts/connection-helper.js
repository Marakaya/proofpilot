// Isolated invocation of the pinned official Copilot Connect helper.
// The caller's project, npm configuration, Node preload settings and token-like
// environment values never decide which helper runs or what it receives.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { requireNodeRuntime } from "./node-runtime.js";

export const CONNECTION_HELPER_PACKAGE = "@colosseum-org/copilot-connect@0.2.2";
export const CONNECTION_HELPER_VERSION = "0.2.2";
// SHA-256 over an unambiguous, length-framed description of the sorted
// extracted package tree. Files contribute their length and individual digest.
// This rejects a same-name/version package and any extra or replaced file.
export const CONNECTION_HELPER_TREE_SHA256 = "e7915db33f314949f19d1735b5681f1a5c452a72045375da76efaf214ca7475f";

const temporaryPrefix = ".proofpilot-helper-";
// The pinned helper needs locale/terminal context and, for browser login, the
// desktop-session selectors below. Unknown caller values are never forwarded:
// arbitrary names such as DATABASE_URL can carry credentials or loader policy.
const forwardedEnvironmentNames = new Map([
  ["LANG", "LANG"], ["LANGUAGE", "LANGUAGE"], ["LC_ALL", "LC_ALL"],
  ["LC_CTYPE", "LC_CTYPE"], ["LC_MESSAGES", "LC_MESSAGES"],
  ["TERM", "TERM"], ["COLORTERM", "COLORTERM"], ["NO_COLOR", "NO_COLOR"], ["FORCE_COLOR", "FORCE_COLOR"],
  ["DISPLAY", "DISPLAY"], ["WAYLAND_DISPLAY", "WAYLAND_DISPLAY"], ["XAUTHORITY", "XAUTHORITY"],
  ["XDG_CURRENT_DESKTOP", "XDG_CURRENT_DESKTOP"], ["XDG_SESSION_DESKTOP", "XDG_SESSION_DESKTOP"],
  ["XDG_SESSION_TYPE", "XDG_SESSION_TYPE"], ["DESKTOP_SESSION", "DESKTOP_SESSION"],
  ["SYSTEMROOT", "SystemRoot"], ["WINDIR", "WINDIR"]
]);
// Fixed subcommands and flags only; nothing shell-sensitive reaches a subprocess.
const safeArgument = /^(?:[A-Za-z0-9@][A-Za-z0-9@._:=+\/-]{0,199}|--?[A-Za-z][A-Za-z0-9-]{0,63})$/;

// Only diagnostics constructed here may reach setup output. Native filesystem
// errors and helper replies can contain private caller context and stay hidden.
class HelperEnvironmentError extends Error {
  constructor(message) {
    super(`${message} Preserve the path and confirm its ownership, permissions and non-symlinked directory chain before repairing it, then retry setup.js --status. Saved credentials were not inspected or changed; do not reconnect on this failure.`);
    this.name = "HelperEnvironmentError";
    this.code = "EHELPERENV";
  }
}

export function helperEnvironmentDiagnostic(error) {
  if (error?.code === "ENODERUNTIME") return error.message;
  return error instanceof HelperEnvironmentError ? error.message :
    "The connection-helper environment could not be prepared. Check the account home and helper/config directory ownership and permissions, then retry setup.js --status. Saved credentials were not inspected or changed; do not reconnect on this failure.";
}

function projectBinEntry(entry) {
  const parts = entry.replace(/\\/g, "/").split("/").filter(Boolean).map(part => part.toLowerCase());
  return parts.some((part, index) => part === "node_modules" && parts[index + 1] === ".bin");
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function securePrivateBase() {
  // Resolve the account database home instead of trusting HOME/USERPROFILE.
  let home;
  try { home = os.userInfo().homedir; } catch { home = os.homedir(); }
  if (!home || !path.isAbsolute(home)) throw new HelperEnvironmentError("The account home directory is unavailable for the connection helper.");
  const candidate = fs.realpathSync(home);
  const stat = fs.lstatSync(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new HelperEnvironmentError("The user home is not a safe helper workspace.");
  if (typeof process.getuid === "function") {
    const uid = process.getuid();
    if (stat.uid !== uid || (stat.mode & 0o022) !== 0) throw new HelperEnvironmentError("The user home is not private enough for the connection helper.");
    let current = candidate;
    while (true) {
      const ancestor = fs.lstatSync(current);
      if (!ancestor.isDirectory() || (ancestor.uid !== uid && ancestor.uid !== 0) || ((ancestor.mode & 0o022) !== 0 && !(ancestor.mode & 0o1000))) {
        throw new HelperEnvironmentError("A helper workspace ancestor is controlled or writable by another user.");
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return candidate;
}

function createPrivateWorkspace() {
  let base = securePrivateBase();
  for (const name of [".proofpilot", "helper-work"]) {
    base = path.join(base, name);
    try { fs.mkdirSync(base, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    if (!safeOwnedEntry(base, "directory")) throw new HelperEnvironmentError(`The helper workspace directory is unsafe: ${JSON.stringify(base)}.`);
  }
  for (const name of fs.readdirSync(base)) {
    if (!/^\.proofpilot-helper-\d+-[A-Za-z0-9]+$/.test(name)) continue;
    const directory = path.join(base, name);
    try {
      if (!safeOwnedEntry(directory, "directory")) continue;
      const ownerFile = path.join(directory, ".proofpilot-owner.json");
      if (!safeOwnedEntry(ownerFile, "file") || fs.lstatSync(ownerFile).size > 4096) continue;
      const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
      const identity = fs.lstatSync(directory, { bigint: true });
      if (owner.hostname !== os.hostname() || owner.dev !== String(identity.dev) || owner.ino !== String(identity.ino) ||
          !Number.isSafeInteger(owner.pid) || owner.pid < 1) continue;
      try { process.kill(owner.pid, 0); continue; } catch (error) { if (error.code !== "ESRCH") continue; }
      fs.rmSync(directory, { recursive: true });
    } catch { /* Keep every workspace whose dead owner cannot be proven. */ }
  }
  const cwd = fs.mkdtempSync(path.join(base, `${temporaryPrefix}${process.pid}-`));
  fs.chmodSync(cwd, 0o700);
  const stat = fs.lstatSync(cwd);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === "function" &&
      (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) {
    fs.rmSync(cwd, { recursive: true, force: true });
    throw new HelperEnvironmentError("Could not create a private helper workspace.");
  }
  const identity = fs.lstatSync(cwd, { bigint: true });
  fs.writeFileSync(path.join(cwd, ".proofpilot-owner.json"), JSON.stringify({ pid: process.pid, hostname: os.hostname(),
    dev: String(identity.dev), ino: String(identity.ino) }), { flag: "wx", mode: 0o600 });
  return cwd;
}

function safeOwnedEntry(file, type) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (type === "directory" ? !stat.isDirectory() : !stat.isFile())) return false;
  if (typeof process.getuid === "function" && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0)) return false;
  return true;
}

function packageTreeDigest(root) {
  const digest = createHash("sha256");
  const limit = { entries: 0, bytes: 0 };
  const walk = (directory, relative = "") => {
    if (!safeOwnedEntry(directory, "directory")) throw new Error("unsafe helper package tree");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (++limit.entries > 256 || entry.isSymbolicLink()) throw new Error("unsafe helper package tree");
      const file = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        digest.update(`d ${Buffer.byteLength(name)}:${name}\n`);
        walk(file, name);
      } else if (entry.isFile() && safeOwnedEntry(file, "file")) {
        const stat = fs.lstatSync(file);
        limit.bytes += stat.size;
        if (limit.bytes > 1024 * 1024) throw new Error("oversized helper package tree");
        const bytes = fs.readFileSync(file);
        digest.update(`f ${Buffer.byteLength(name)}:${name} ${bytes.length} ${createHash("sha256").update(bytes).digest("hex")}\n`);
      } else throw new Error("unsafe helper package tree");
    }
  };
  walk(root);
  return digest.digest("hex");
}

function canonicalPath(location) {
  let cursor = path.resolve(location);
  const tail = [];
  while (true) {
    let exists = true;
    try {
      fs.lstatSync(cursor);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      exists = false;
    }
    // lstat distinguishes an absent component from a dangling link. realpath
    // canonicalizes a usable link and throws for a dangling one, so it can
    // never be reclassified as a path that is safe to create later.
    if (exists) return path.join(fs.realpathSync(cursor), ...tail);
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error("Could not resolve the helper cache path.");
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
}

function safeManagedPath(base, destination, { allowMissing = false } = {}) {
  base = path.resolve(base); destination = path.resolve(destination);
  if (!isContained(base, destination) || !safeOwnedEntry(base, "directory")) return false;
  let current = base;
  for (const part of path.relative(base, destination).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (!safeOwnedEntry(current, "directory")) return false;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return allowMissing;
    }
  }
  return true;
}

function managedHelperRoot(cache) {
  return cache ? path.join(cache, "_proofpilot_helpers", `copilot-connect-${CONNECTION_HELPER_VERSION}`) :
    path.join(securePrivateBase(), ".proofpilot", "helpers", `copilot-connect-${CONNECTION_HELPER_VERSION}`);
}

function managedHelperEntrypoint(root, base) {
  try {
    if (!safeManagedPath(base, root)) return null;
    const packageRoot = path.join(root, "node_modules", "@colosseum-org", "copilot-connect");
    const packageFile = path.join(packageRoot, "package.json");
    if (!safeManagedPath(root, packageRoot) || !safeOwnedEntry(packageFile, "file")) return null;
    const stat = fs.statSync(packageFile);
    if (stat.size > 64 * 1024) return null;
    const metadata = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    const executable = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.["copilot-connect"];
    if (metadata.name !== "@colosseum-org/copilot-connect" || metadata.version !== CONNECTION_HELPER_VERSION ||
        typeof executable !== "string" || path.isAbsolute(executable)) return null;
    const cli = path.resolve(packageRoot, executable);
    return isContained(packageRoot, cli) && safeOwnedEntry(cli, "file") &&
      packageTreeDigest(packageRoot) === CONNECTION_HELPER_TREE_SHA256 ? cli : null;
  } catch { return null; }
}

export function trustedNpmCli() {
  const node = fs.realpathSync(process.execPath);
  const nodeDirectory = path.dirname(node);
  const prefix = path.dirname(path.dirname(node));
  const candidates = [
    path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(prefix, "libexec", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(prefix, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(prefix, "share", "nodejs", "npm", "bin", "npm-cli.js")
  ];
  const nodeOwner = fs.statSync(node).uid;
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate);
      const stat = fs.lstatSync(resolved);
      if (!isContained(prefix, resolved) || !stat.isFile() || stat.isSymbolicLink()) continue;
      if (typeof process.getuid === "function" && ((stat.mode & 0o022) !== 0 || stat.uid !== nodeOwner)) continue;
      const packageFile = path.resolve(path.dirname(resolved), "..", "package.json");
      const packageStat = fs.lstatSync(packageFile);
      if (!packageStat.isFile() || packageStat.isSymbolicLink() || packageStat.size > 128 * 1024) continue;
      const metadata = JSON.parse(fs.readFileSync(packageFile, "utf8"));
      if (metadata.name !== "npm" || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(metadata.version ?? "")) continue;
      return resolved;
    } catch { /* Try the next layout. */ }
  }
  return null;
}

function missingHelperArgs() {
  return ["--input-type=module", "--eval", "process.stderr.write('ENOTCACHED: exact connection helper is not installed in the managed helper cache\\n'); process.exit(1);"];
}

// Only preparing an absent helper needs npm, so a missing npm is its own prerequisite.
const npmUnavailableDiagnostic = "The pinned connection helper is not prepared, and preparing it needs the npm CLI installed with " +
  "the running Node.js; none passed the ownership and permission checks (same owner as the node executable, not writable by " +
  "group or others). Install or repair npm for this Node.js, then retry setup.js --prepare-colosseum-helper, followed by " +
  "setup.js --status. Inspect the resulting connection state before any sign-in. A validated prepared " +
  "helper runs without npm. Saved account credentials were not inspected or changed.";

function npmUnavailableArgs() {
  return ["--input-type=module", "--eval", "process.stderr.write('EHELPERNPM: ' + process.argv[1] + '\\n'); process.exit(1);", "--", npmUnavailableDiagnostic];
}

/** Operator recovery text for an existing managed helper root that failed validation. */
function untrustedHelperCacheDiagnostic(root) {
  return `The managed connection-helper cache at ${JSON.stringify(root)} exists but is incomplete or untrusted; ` +
    "it was not executed, repaired or removed, and saved account credentials were not inspected. " +
    "Preserve it: confirm that this directory belongs to your account and is not in use, move the whole directory aside " +
    "(for example rename it with a .quarantine suffix) instead of deleting it, then explicitly retry helper preparation " +
    "with setup.js --prepare-colosseum-helper, followed by setup.js --status. Inspect the resulting connection state before any sign-in.";
}

// lstat only: an absent root may be prepared; anything else present is kept untouched.
function existingHelperCacheIssue(root) {
  try { fs.lstatSync(root); }
  catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return null; }
  return { code: "helper_untrusted", path: root, diagnostic: untrustedHelperCacheDiagnostic(root) };
}

function untrustedHelperArgs(issue) {
  return ["--input-type=module", "--eval", "process.stderr.write('EHELPERCACHE: ' + process.argv[1] + '\\n'); process.exit(1);", "--", issue.diagnostic];
}

const onlineBootstrap = String.raw`
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const [managedBase, managedRoot, npmCli, packageSpec, packageVersion, packageTreeSha256, ...requested] = process.argv.slice(1);
process.umask(0o077);
function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}
function safeEntry(file, type) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (type === "directory" ? !stat.isDirectory() : !stat.isFile())) return false;
  if (typeof process.getuid === "function" && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0)) return false;
  return true;
}
function ensureChain(base, destination, create) {
  try {
    if (!path.isAbsolute(base) || !path.isAbsolute(destination) || !contained(base, destination) || !safeEntry(base, "directory")) return false;
    let current = base;
    for (const part of path.relative(base, destination).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) {
        if (!create) return false;
        fs.mkdirSync(current, { mode: 0o700 });
      }
      if (!safeEntry(current, "directory")) return false;
    }
    return true;
  } catch { return false; }
}
function entrypoint(root = managedRoot) {
  try {
    if (!ensureChain(managedBase, root, false)) return null;
    const packageRoot = path.join(root, "node_modules", "@colosseum-org", "copilot-connect");
    if (!ensureChain(root, packageRoot, false)) return null;
    let count = 0;
    let bytes = 0;
    const digest = crypto.createHash("sha256");
    const walk = (directory, relative = "") => {
      const directoryStat = fs.lstatSync(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
          (typeof process.getuid === "function" && (directoryStat.uid !== process.getuid() || (directoryStat.mode & 0o022) !== 0))) throw new Error("unsafe tree");
      for (const name of fs.readdirSync(directory).sort()) {
        if (++count > 256) throw new Error("unsafe tree");
        const file = path.join(directory, name);
        const relativeName = relative ? relative + "/" + name : name;
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) ||
            (typeof process.getuid === "function" && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0))) throw new Error("unsafe tree");
        if (stat.isDirectory()) {
          digest.update("d " + Buffer.byteLength(relativeName) + ":" + relativeName + "\n");
          walk(file, relativeName);
        } else {
          bytes += stat.size;
          if (bytes > 1024 * 1024) throw new Error("unsafe tree");
          const contents = fs.readFileSync(file);
          digest.update("f " + Buffer.byteLength(relativeName) + ":" + relativeName + " " + contents.length + " " + crypto.createHash("sha256").update(contents).digest("hex") + "\n");
        }
      }
    };
    walk(packageRoot);
    if (digest.digest("hex") !== packageTreeSha256) return null;
    const metadataFile = path.join(packageRoot, "package.json");
    const stat = fs.lstatSync(metadataFile);
    if (!stat.isFile() || stat.size > 65536) return null;
    const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
    const executable = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.["copilot-connect"];
    if (metadata.name !== "@colosseum-org/copilot-connect" || metadata.version !== packageVersion || typeof executable !== "string" || path.isAbsolute(executable)) return null;
    const cli = path.resolve(packageRoot, executable);
    const relative = path.relative(packageRoot, cli);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || !fs.lstatSync(cli).isFile()) return null;
    return cli;
  } catch { return null; }
}
let cli = entrypoint();
if (!cli) {
  if (fs.existsSync(managedRoot)) {
    process.stderr.write("EHELPERCACHE: managed connection-helper installation at " + JSON.stringify(managedRoot) +
      " is incomplete or untrusted and was not executed or removed; preserve it, confirm ownership, move it aside, then explicitly retry helper preparation\n");
    process.exit(1);
  }
  const parent = path.dirname(managedRoot);
  if (!ensureChain(managedBase, parent, true)) {
    process.stderr.write("EHELPERCACHE: managed connection-helper parent is unsafe\n");
    process.exit(1);
  }
  const staging = managedRoot + ".staging-" + process.pid + "-" + crypto.randomBytes(8).toString("hex");
  try {
    fs.mkdirSync(staging, { mode: 0o700 });
    const installed = spawnSync(process.execPath, [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--package-lock=false", "--save=false", "--bin-links=false", "--loglevel=error", "--prefix", staging, packageSpec], {
      cwd: staging, env: process.env, encoding: "utf8", timeout: 90000, maxBuffer: 262144, windowsHide: true, stdio: ["ignore", "ignore", "pipe"]
    });
    if (installed.status !== 0) throw new Error("install failed");
    if (!entrypoint(staging)) throw new Error("validation failed");
    try { fs.renameSync(staging, managedRoot); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code) || !entrypoint()) throw error;
      fs.rmSync(staging, { recursive: true, force: true });
    }
    cli = entrypoint();
    if (!cli) throw new Error("validation failed");
  } catch {
    fs.rmSync(staging, { recursive: true, force: true });
    process.stderr.write("EHELPERINSTALL: could not prepare the exact connection helper without lifecycle scripts\n");
    process.exit(1);
  }
}
const result = spawnSync(process.execPath, [cli, ...requested], { cwd: managedRoot, env: process.env, stdio: "inherit", windowsHide: true, timeout: requested.includes("--version") ? 15000 : undefined });
if (result.error) { process.stderr.write("EHELPEREXEC: connection helper could not start\n"); process.exit(1); }
process.exitCode = result.status ?? 1;
`;

function windowsSystemAnchor() {
  try {
    // Node obtains sharedObjects from the modules loaded in this process. The
    // Windows Known DLLs provide an OS location independent of caller env.
    // Never retain or serialize the report: its other fields may hold secrets.
    const sharedObjects = process.report?.getReport?.().sharedObjects;
    if (!Array.isArray(sharedObjects)) return null;
    const systemDirectories = [];
    for (const name of ["ntdll.dll", "kernel32.dll"]) {
      const matches = sharedObjects.filter(file => typeof file === "string" && path.basename(file).toLowerCase() === name);
      if (matches.length !== 1 || !path.isAbsolute(matches[0])) return null;
      const module = path.resolve(matches[0]);
      const resolved = fs.realpathSync(module);
      const stat = fs.lstatSync(module);
      if (resolved.toLowerCase() !== module.toLowerCase() || !stat.isFile() || stat.isSymbolicLink()) return null;
      systemDirectories.push(path.dirname(resolved));
    }
    const system = systemDirectories[0];
    if (system.toLowerCase() !== systemDirectories[1].toLowerCase() || !/^(?:system32|syswow64)$/i.test(path.basename(system))) return null;
    const root = path.dirname(system);
    const directories = [];
    for (const candidate of [root, system, path.join(system, "Wbem"), path.join(system, "WindowsPowerShell", "v1.0")]) {
      try {
        const resolved = fs.realpathSync(candidate);
        const stat = fs.lstatSync(candidate);
        if (resolved.toLowerCase() !== candidate.toLowerCase() || !stat.isDirectory() || stat.isSymbolicLink()) {
          if (candidate === root || candidate === system) return null;
          continue;
        }
        directories.push(resolved);
      } catch {
        if (candidate === root || candidate === system) return null;
      }
    }
    return { root, directories, allowed: new Set(directories.map(directory => directory.toLowerCase())) };
  } catch { return null; }
}

function trustedPathEntry(entry, windowsAnchor) {
  try {
    if (!entry || !path.isAbsolute(entry) || projectBinEntry(entry)) return null;
    const resolved = fs.realpathSync(entry);
    if (!fs.lstatSync(resolved).isDirectory()) return null;
    if (process.platform === "win32") {
      return windowsAnchor && path.resolve(entry).toLowerCase() === resolved.toLowerCase() &&
        windowsAnchor.allowed.has(resolved.toLowerCase()) ? resolved : null;
    }
    if (typeof process.getuid === "function") {
      let current = resolved;
      while (true) {
        const stat = fs.lstatSync(current);
        if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) return null;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return resolved;
    }
    return null;
  } catch { return null; }
}

/**
 * Canonical file for `executable` from a search PATH built by helperEnvironment,
 * or null. A link in a verified directory confers no trust of its own: on POSIX
 * the resolved file must be a root-owned executable that group and others cannot
 * write, and its own directory chain must pass the root-owned PATH policy. On
 * Windows the regular file's canonical parent must also be one of the
 * directories anchored to loaded OS modules; a PATH link cannot grant it trust.
 */
export function trustedSystemExecutable(executable, searchPath) {
  const windowsAnchor = process.platform === "win32" ? windowsSystemAnchor() : null;
  for (const directory of String(searchPath ?? "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    try {
      const resolved = fs.realpathSync(path.join(directory, executable));
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile()) continue;
      if (process.platform === "win32") {
        if (trustedPathEntry(path.dirname(resolved), windowsAnchor) !== null) return resolved;
        continue;
      }
      if (typeof process.getuid === "function" && stat.uid === 0 && (stat.mode & 0o022) === 0 && (stat.mode & 0o111) !== 0 &&
          trustedPathEntry(path.dirname(resolved)) !== null) return resolved;
    } catch { /* Try the next verified directory. */ }
  }
  return null;
}

function trustedConfigHome(env) {
  const home = securePrivateBase();
  const requested = typeof env?.XDG_CONFIG_HOME === "string" && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : null;
  for (const candidate of [requested, path.join(home, ".config")].filter(Boolean)) {
    try {
      const resolved = canonicalPath(candidate);
      if (isContained(home, resolved) && safeManagedPath(home, resolved, { allowMissing: true })) return resolved;
    } catch { /* Fall back to the fixed config directory under the verified home. */ }
  }
  throw new HelperEnvironmentError(`The connection-helper config path is unsafe: ${JSON.stringify(path.join(home, ".config"))}.`);
}

function trustedLinuxSessionEnvironment() {
  if (process.platform !== "linux" || typeof process.getuid !== "function") return {};
  const uid = process.getuid();
  const runtime = `/run/user/${uid}`;
  try {
    const runtimeStat = fs.lstatSync(runtime);
    if (!runtimeStat.isDirectory() || runtimeStat.isSymbolicLink() || runtimeStat.uid !== uid || (runtimeStat.mode & 0o077) !== 0) return {};
    const bus = path.join(runtime, "bus");
    const busStat = fs.lstatSync(bus);
    if (!busStat.isSocket() || busStat.isSymbolicLink() || busStat.uid !== uid) return { XDG_RUNTIME_DIR: runtime };
    return { XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${bus}` };
  } catch { return {}; }
}

function searchPath(value, windowsAnchor) {
  const defaults = process.platform === "win32" ? windowsAnchor?.directories ?? [] : ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const entries = [...defaults, ...String(value).split(path.delimiter)];
  return [...new Set(entries.map(entry => trustedPathEntry(entry, windowsAnchor)).filter(Boolean))].join(path.delimiter);
}

/** PATH containing only verified OS directories or POSIX root-owned entries. */
export function helperSearchPath(value = "") {
  return searchPath(value, process.platform === "win32" ? windowsSystemAnchor() : null);
}

/** Small nonsecret caller context allowlist plus separately validated paths. */
export function helperEnvironment(env = process.env) {
  const clean = {};
  const paths = [];
  const windowsAnchor = process.platform === "win32" ? windowsSystemAnchor() : null;
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value === undefined || value === null) continue;
    const upper = key.toUpperCase();
    if (upper === "PATH") { paths.push(String(value)); continue; }
    if (process.platform === "win32" && (upper === "SYSTEMROOT" || upper === "WINDIR")) continue;
    const forwarded = forwardedEnvironmentNames.get(upper);
    if (forwarded) clean[forwarded] = String(value);
  }
  clean.PATH = searchPath(paths.join(path.delimiter), windowsAnchor);
  if (windowsAnchor) {
    clean.SystemRoot = windowsAnchor.root;
    clean.WINDIR = windowsAnchor.root;
  }
  clean.XDG_CONFIG_HOME = trustedConfigHome(env);
  return clean;
}

/**
 * Build a spawn description for the pinned helper. A managed helper that passes
 * validation runs directly with the restricted environment for every operation,
 * online or offline; npm is never needed for it. Only online preparation of an
 * absent helper uses npm, from a private temporary directory with its own
 * package.json and two empty npmrc files, so a caller project's node_modules,
 * .npmrc or npm_config_* values cannot shadow the official package. When that
 * preparation has no trusted npm CLI, `helperPrerequisiteIssue` says so and the
 * command only prints the npm diagnostic. No credential is placed in argv or env.
 * `cache` is an explicit absolute npm cache used by tests; callers normally omit
 * it. `cleanup()` removes only the temporary directory created here. When the
 * managed helper root exists but fails validation, `helperCacheIssue` names it
 * and the command only prints the recovery diagnostic, online or offline.
 */
export function createHelperInvocation(args, { online = false, env = process.env, cache } = {}) {
  requireNodeRuntime();
  if (!Array.isArray(args) || args.length > 8 || args.some(arg => typeof arg !== "string" || !safeArgument.test(arg))) {
    throw new Error("Unsupported helper arguments.");
  }
  if (cache !== undefined && (typeof cache !== "string" || !path.isAbsolute(cache))) {
    throw new Error("An explicit helper cache must be an absolute path.");
  }
  const home = securePrivateBase();
  const cacheRoot = cache ? canonicalPath(cache) : null;
  const managedBase = cache ? cacheRoot : home;
  const managedRoot = managedHelperRoot(cacheRoot);
  // Check an absent helper's parent before the offline ENOTCACHED branch too.
  // Absence beneath an unsafe directory is an environment failure, not evidence
  // that preparing a helper or signing in can repair the path.
  const managedParent = path.dirname(managedRoot);
  let parentSafe = false;
  try { parentSafe = safeManagedPath(managedBase, managedParent, { allowMissing: true }); } catch { /* Report only the constructed path diagnostic below. */ }
  if (!parentSafe) throw new HelperEnvironmentError(`The managed connection-helper parent path is unsafe: ${JSON.stringify(managedParent)}.`);
  const validated = managedHelperEntrypoint(managedRoot, managedBase);
  // An existing root that fails validation is never executed or prepared over.
  const helperCacheIssue = validated ? null : existingHelperCacheIssue(managedRoot);
  let cwd = validated ? managedRoot : home;
  let workspace = null;
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    if (workspace) {
      try { fs.rmSync(workspace, { recursive: true, force: true }); }
      catch { /* A cleanup failure must not change the helper's result. */ }
    }
  };
  try {
    const helperEnv = helperEnvironment(env);
    helperEnv.HOME = home;
    helperEnv.USERPROFILE = home;
    Object.assign(helperEnv, trustedLinuxSessionEnvironment());
    if (helperCacheIssue) return { command: process.execPath, args: untrustedHelperArgs(helperCacheIssue),
      shell: false, cwd, env: helperEnv, cleanup, helperCacheIssue };
    // A validated helper runs directly for login, token and status alike, and an
    // offline lookup never prepares one: neither needs npm, its config or a workspace.
    if (validated || !online) return { command: process.execPath, args: validated ? [validated, ...args] : missingHelperArgs(),
      shell: false, cwd, env: helperEnv, cleanup };
    const npmCli = trustedNpmCli();
    if (!npmCli) return { command: process.execPath, args: npmUnavailableArgs(), shell: false, cwd, env: helperEnv, cleanup,
      helperPrerequisiteIssue: { code: "helper_npm_unavailable", diagnostic: npmUnavailableDiagnostic } };
    cwd = workspace = createPrivateWorkspace();
    // A package.json here makes this directory npm's project root instead of a caller folder.
    fs.writeFileSync(path.join(cwd, "package.json"), "{\"private\":true}\n", { flag: "wx", mode: 0o600 });
    const userConfig = path.join(cwd, "user.npmrc");
    const globalConfig = path.join(cwd, "global.npmrc");
    fs.writeFileSync(userConfig, "", { flag: "wx", mode: 0o600 });
    fs.writeFileSync(globalConfig, "", { flag: "wx", mode: 0o600 });
    helperEnv.npm_config_userconfig = userConfig;
    helperEnv.npm_config_globalconfig = globalConfig;
    helperEnv.npm_config_update_notifier = "false";
    helperEnv.npm_config_ignore_scripts = "true";
    helperEnv.npm_config_audit = "false";
    helperEnv.npm_config_fund = "false";
    helperEnv.npm_config_logs_max = "0";
    helperEnv.HOME = securePrivateBase();
    helperEnv.USERPROFILE = helperEnv.HOME;
    helperEnv.TMPDIR = cwd;
    helperEnv.TMP = cwd;
    helperEnv.TEMP = cwd;
    Object.assign(helperEnv, trustedLinuxSessionEnvironment());
    // Login, token and offline status must address the same protected backend.
    // A disposable config home makes file-backed/headless connections invisible.
    helperEnv.XDG_CONFIG_HOME = trustedConfigHome(env);
    if (cache) helperEnv.npm_config_cache = cacheRoot;
    return {
      command: process.execPath,
      args: ["--input-type=module", "--eval", onlineBootstrap, "--", managedBase, managedRoot, npmCli,
        CONNECTION_HELPER_PACKAGE, CONNECTION_HELPER_VERSION, CONNECTION_HELPER_TREE_SHA256, ...args],
      shell: false,
      cwd,
      env: helperEnv,
      cleanup
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
