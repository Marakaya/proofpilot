#!/usr/bin/env node
// Explicit local export only. Select by session metadata, never global recency.
import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const READ_BYTES = 64 * 1024;
const MAX_FILES = 10000;
const MAX_SESSION_BYTES = 128 * 1024 * 1024;
class SessionInspectionError extends Error {}
function absoluteDirectory(directory, label) {
  if (typeof directory !== "string" || !directory || directory.startsWith("~") || !path.isAbsolute(directory)) {
    throw new Error(`${label} must be an absolute path; shell-style ~ and relative paths are not accepted.`);
  }
  return directory;
}
function canonical(directory) {
  try { return fs.realpathSync.native(directory); }
  catch { return path.resolve(directory); }
}
function sessionFiles(directory, remaining = { count: MAX_FILES }, depth = 0) {
  if (depth > 32) throw new SessionInspectionError("Project session inspection limit exceeded: directory depth is greater than 32; no export was selected.");
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw new SessionInspectionError(`Could not inspect project session directory ${directory} (${error.code || error.message}); no export was selected.`, { cause: error });
  }
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...sessionFiles(file, remaining, depth + 1));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      if (remaining.count <= 0) throw new SessionInspectionError(`Project session inspection limit exceeded: more than ${MAX_FILES} candidate files; no export was selected.`);
      remaining.count--;
      files.push(file);
    }
  }
  return files;
}
function* sessionRecords(descriptor, size, snapshot) {
  const buffer = snapshot ? null : Buffer.alloc(READ_BYTES);
  let offset = 0;
  let fragments = [];
  const parsed = bytes => {
    try { return JSON.parse(bytes.toString("utf8")); } catch { return null; }
  };
  while (offset < size) {
    const length = snapshot ? Math.min(READ_BYTES, size - offset) :
      fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (!length) throw new SessionInspectionError("Selected project session changed during inspection; no fallback used.");
    const chunk = snapshot ? snapshot.subarray(offset, offset + length) : buffer.subarray(0, length);
    let start = 0;
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      fragments.push(Buffer.from(chunk.subarray(start, end)));
      yield parsed(fragments.length === 1 ? fragments[0] : Buffer.concat(fragments));
      fragments = [];
      start = end + 1;
    }
    if (start < length) fragments.push(Buffer.from(chunk.subarray(start)));
    offset += length;
  }
  if (fragments.length) yield parsed(fragments.length === 1 ? fragments[0] : Buffer.concat(fragments));
}
function sameOutputStat(left, right) {
  return left && right && right.isFile() &&
    ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"].every(key => left[key] === right[key]);
}
function readSessionSnapshot(descriptor) {
  const before = fs.fstatSync(descriptor, { bigint: true });
  if (!before.isFile()) throw new SessionInspectionError("Selected project session is not a regular file; no export was selected.");
  if (before.size > BigInt(MAX_SESSION_BYTES)) throw new SessionInspectionError(`Project session inspection limit exceeded: a candidate exceeds ${MAX_SESSION_BYTES} bytes; no export was selected.`);
  const snapshot = Buffer.allocUnsafe(Number(before.size));
  let offset = 0;
  while (offset < snapshot.length) {
    const length = fs.readSync(descriptor, snapshot, offset, Math.min(READ_BYTES, snapshot.length - offset), offset);
    if (!length) throw new SessionInspectionError("Selected project session changed during snapshot; no fallback used.");
    offset += length;
  }
  if (!sameOutputStat(before, fs.fstatSync(descriptor, { bigint: true }))) {
    throw new SessionInspectionError("Selected project session changed during snapshot; no fallback used.");
  }
  return snapshot;
}
function cleanupOutput(created, error) {
  let descriptor;
  try {
    let stat;
    try { stat = fs.lstatSync(created.path, { bigint: true }); }
    catch (missing) { if (missing.code === "ENOENT") return; throw missing; }
    if (!sameOutputStat(created.stat, stat) || stat.size !== BigInt(created.bytes)) throw new Error("Export output changed.");
    descriptor = fs.openSync(created.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    if (!sameOutputStat(stat, fs.fstatSync(descriptor, { bigint: true }))) throw new Error("Export output changed.");
    const digest = createHash("sha256");
    const buffer = Buffer.alloc(READ_BYTES);
    let offset = 0;
    while (offset < created.bytes) {
      const length = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, created.bytes - offset), offset);
      if (!length) throw new Error("Export output changed.");
      digest.update(buffer.subarray(0, length));
      offset += length;
    }
    if (digest.digest("hex") !== created.digest.copy().digest("hex") ||
        !sameOutputStat(stat, fs.fstatSync(descriptor, { bigint: true }))) throw new Error("Export output changed.");
    fs.closeSync(descriptor);
    descriptor = undefined;
    // This narrows ordinary editor-save races, but check/unlink is not an
    // atomic filesystem ownership primitive against an arbitrary writer.
    if (!sameOutputStat(stat, fs.lstatSync(created.path, { bigint: true }))) throw new Error("Export output changed.");
    fs.unlinkSync(created.path);
  } catch {
    error.message += ` Export cleanup preserved an output whose identity or contents could not be verified: ${created.path}.`;
  } finally { if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} } }
}
function sessionMatches(file, project, destination) {
  let descriptor;
  let created;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_SESSION_BYTES) throw new SessionInspectionError(`Project session inspection limit exceeded: a candidate exceeds ${MAX_SESSION_BYTES} bytes; no export was selected.`);
    // An open descriptor preserves the inode, not its contents. Validate and
    // publish the same bounded bytes; never reread the source after validation.
    const snapshot = destination ? readSessionSnapshot(descriptor) : null;
    for (const entry of sessionRecords(descriptor, snapshot ? snapshot.length : stat.size, snapshot)) {
      const cwd = entry?.type === "session_meta" ? entry.payload?.cwd :
        ["user", "assistant", "system", "summary"].includes(entry?.type) ? entry.cwd : undefined;
      if (typeof cwd === "string" && path.isAbsolute(cwd)) {
        // The first real metadata cwd decides ownership; never accept a later
        // message containing a different project's path.
        if (canonical(cwd) !== project) return null;
        if (destination) {
          let output;
          try {
            output = fs.openSync(destination, "wx", 0o600);
            created = { path: destination, bytes: 0, digest: createHash("sha256") };
            created.stat = fs.fstatSync(output, { bigint: true });
            let offset = 0;
            while (offset < snapshot.length) {
              const length = Math.min(READ_BYTES, snapshot.length - offset);
              let written = 0;
              while (written < length) {
                const count = fs.writeSync(output, snapshot, offset + written, length - written, offset + written);
                if (!count) throw new Error("Selected project session output could not be written.");
                created.digest.update(snapshot.subarray(offset + written, offset + written + count));
                created.bytes += count;
                created.stat = fs.fstatSync(output, { bigint: true });
                written += count;
              }
              offset += length;
            }
            const closing = output;
            output = undefined;
            fs.closeSync(closing);
          } catch (error) {
            if (output !== undefined) { try { fs.closeSync(output); } catch {} output = undefined; }
            if (created) cleanupOutput(created, error);
            throw error;
          } finally { if (output !== undefined) fs.closeSync(output); }
        }
        return { file, mtime: stat.mtimeMs, created };
      }
    }
  } catch (error) {
    if (destination || error instanceof SessionInspectionError) throw error;
    if (descriptor === undefined && error.code === "ENOENT") return null;
    throw new SessionInspectionError(`Could not inspect project session ${file} (${error.code || error.message}); no export was selected.`, { cause: error });
  }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  return null;
}

export function exportProjectSessions({ projectDir, outputDir = projectDir, claudeHome, codexHome }) {
  const project = canonical(projectDir);
  absoluteDirectory(claudeHome, "Claude configuration directory");
  absoluteDirectory(codexHome, "CODEX_HOME");
  const selected = [
    { provider: "claude", name: "claude-session.jsonl", directory: path.join(claudeHome, "projects") },
    { provider: "codex", name: "codex-session.jsonl", directory: path.join(codexHome, "sessions") }
  ].map(item => ({
    ...item,
    session: sessionFiles(item.directory).map(file => sessionMatches(file, project)).filter(Boolean).sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file))[0]
  }));
  const pending = selected.filter(item => item.session);
  for (const item of pending) {
    const destination = path.resolve(outputDir, item.name);
    try { fs.lstatSync(destination); throw new Error(`Export destination already exists; preserve it and choose a new output directory: ${destination}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const exported = [];
  const created = [];
  try {
    if (pending.length) fs.mkdirSync(outputDir, { recursive: true });
    for (const item of pending) {
      const destination = path.resolve(outputDir, item.name);
      // Capture through a non-symlink descriptor and validate the copied bytes.
      const session = sessionMatches(item.session.file, project, destination);
      if (!session) throw new Error("Selected project session changed before export; no fallback used.");
      created.push(session.created);
      exported.push({ provider: item.provider, path: destination });
    }
  } catch (error) {
    for (const item of created) cleanupOutput(item, error);
    throw error;
  }
  return { project, exported, not_found: selected.filter(item => !item.session).map(item => item.provider), selection: "matching_project_metadata_only", uploaded: false };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || argv.some(arg => arg.startsWith("--"))) {
    console.error("Usage: export-project-sessions.js [output-directory]. Only sessions whose metadata matches the current project are exported.");
    return 1;
  }
  try {
    const home = os.homedir();
    const result = exportProjectSessions({ projectDir: process.cwd(), outputDir: path.resolve(argv[0] ?? "."), claudeHome: process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_HOME || path.join(home, ".claude"), codexHome: process.env.CODEX_HOME || path.join(home, ".codex") });
    console.log(JSON.stringify(result, null, 2));
    return result.exported.length ? 0 : 2;
  } catch (error) { console.error(error.message); return 1; }
}
function invokedAsMain() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (invokedAsMain()) process.exitCode = main();
