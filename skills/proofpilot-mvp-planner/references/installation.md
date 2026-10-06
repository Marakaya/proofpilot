# Full Support Installation

Repository installers install ProofPilot plus 36 supporting skills by default. The source list, exact Git commits, minimum versions and shared files are in [skill-dependencies.json](skill-dependencies.json). This is a local guidance bundle; account access and project toolchains are checked separately.

## Included Set

- 32 solana.new journey skills: discovery, validation, development, security, design, debugging, launch and pitch work.
- The official `solana-dev` skill, official Colosseum Copilot skill 2.0.0, `ethglobal-skills` and `openai-docs`.
- Six shared Solana data directories, three ecosystem/starter catalogs, the skill router, tone guide and upstream license files.
- Cached official `@colosseum-org/copilot-connect@0.2.2`; installation runs its version command only.

The five ProofPilot stage profiles remain opt-in because the main router covers every stage. Protocol-specific catalog candidates are selected when a project needs them. Google Drive/Slides, Presentations and other host-owned plugins use the host's normal connection flow. They cannot be activated by copying skill files. `create-pitch-deck` supplies local deck guidance when a native presentation tool is unavailable.

## Normal Installation

From the repository, run `node scripts/cli.js install --target codex` (or `claude` / `agents`). Add `--profiles` to include the five stage profiles. `--dir` specifies the absolute exact main skill directory; supporting skills are installed beside it. Relative paths, shell-style `~`, runtime skill roots and runtime configuration directories are rejected. `scripts/install-skills.js --copy` installs all six ProofPilot entrypoints and the same support bundle. Its `--target` is an absolute skill-root path. In copy mode, the main skill and every profile root must be a physical directory. A symlink at any of those roots is an installation-mode mismatch and is never silently reused.

Claude installation, capability discovery and session export honor `CLAUDE_CONFIG_DIR`, followed by the legacy `CLAUDE_HOME` override and then `~/.claude`. Overrides must be absolute paths. Codex capability discovery also requires an absolute `CODEX_HOME` override and rejects relative paths or shell-style `~`. Only that configuration directory's exact `skills` directory is a valid installation root; the configuration directory itself is protected. Windows post-install commands are quoted for PowerShell, including paths containing an apostrophe, and the notice names that shell.

Installation needs Node.js 20+, npm, Git and network access for missing sources. ProofPilot prepares the exact connection-helper package without lifecycle scripts, rejects writable or symlinked managed-store paths, validates its local copy, and runs its JavaScript entrypoint directly with the current Node executable. Sources are downloaded directly from their pinned upstream commits; third-party skills are not redistributed inside ProofPilot's MIT npm package. Declared upstream license files are retained, while the manifest records proprietary or unknown license status for sources that publish no license file. The legacy solana.new Colosseum PAT wrapper is replaced by the official V2 skill.

Compatible support skills and shared files already owned by this installation are reused. Each managed support skill carries a marker paired with bundle provenance, so stale state alone cannot adopt a replacement personal skill. Missing required internal files in owned entries are repaired without replacing unrelated customized files. Local guidance adaptations remove telemetry instructions, resolve bundled paths, select the official Colosseum V2 contract, limit grant exports to the current project, and require scoped authorization for paid requests. Owned earlier copies receive those adaptations with exact upstream originals preserved; unrelated custom text remains. A known version below a required minimum is replaced with a backup only when ownership is verified; unknown, unowned or unrelated folder collisions stop installation. A compatible same-name personal skill is not adopted as ProofPilot-managed content.

`--update-dependencies` explicitly replaces the managed support set with backups. A later release can update an owned prior bundle or pinned source ref without manual deletion; its prior managed content is backed up. `--force` applies only to ProofPilot core and profiles. For a changed core/profile entry, compatible `.proofpilot-bundle.json` state must record that exact destination and inode identity, and the entry's `SKILL.md` must declare its expected name. An inode-owned development symlink, or a profile containing exactly its three recorded links, can also be replaced after its old source checkout disappears. An unowned foreign directory is refused even with `--force`. A pre-identity ProofPilot installation can be migrated only through the explicit `--force --adopt-legacy-core` recovery option; this user-directed adoption requires a matching bundle state and expected skill name, and preserves every replaced entry in a backup. Backups live in `.proofpilot-backups` beside the skill root, or inside that root when a mount boundary requires same-filesystem placement. The CLI prints every absolute backup path. A repeated unchanged installation succeeds without downloading sources.

A full install acquires one exclusive lock for the exact target skill root before it changes installed content. It prepares dependencies on the destination filesystem, writes and fsyncs a transaction journal, activates dependency entries, core and optional profiles, then writes bundle state while that lock remains held. An activation or state-write failure rolls back the entries created by that run and restores backups when their recorded identity and content fingerprint remain valid. A killed process is recovered from the durable journal on the next run; a journal whose expected state hash was already committed is finalized without rolling the installation back. If another process replaced a path during recovery, the installer preserves that path and reports the exact backup/recovery locations instead of deleting content it no longer owns.

`--core-only` deliberately omits support installation and records that preference. `--offline` requires an already complete set and conflicts with `--update-dependencies`. Source/destination overlap, reserved destinations and escaping symlink ancestors are refused before installation writes. New replacements are staged before the active installation moves.

The repository CLI requires an explicit `--root <skill-root>` for every `dependencies` action. The root is the directory that directly contains `proofpilot`, its support-skill siblings and `.proofpilot-bundle.json`; it is not the `proofpilot` directory itself.

```bash
node scripts/cli.js dependencies --root /absolute/path/to/skills --status
node scripts/cli.js dependencies --root /absolute/path/to/skills
node scripts/cli.js dependencies --root /absolute/path/to/skills --update
```

`--status` is an offline, read-only inventory. Each support skill is reported as `missing`, `incompatible`, `incomplete` or `installed`; overall `complete` also requires every shared asset, required policy adaptation and the exact cached connection-helper version. Status does not repair files, prove account access or test project toolchains. A plain dependencies run repairs missing required files and policy adaptations in owned entries while preserving compatible custom content. `--update` replaces managed entries. Unowned, symlinked, special-file or otherwise incompatible collisions stop before download or mutation and must be moved aside by the operator.

Single-file support assets have adjacent `.proofpilot-owners` records paired with bundle provenance. Atomic editor saves retain ownership and compatible custom rows or JSON. Earlier Markdown assets can migrate through their unchanged upstream-original sidecar. Customized directory assets copied to new inodes require an operator decision; the installer does not adopt a copied foreign directory from stale state. Ordinary OS/npm metadata files do not force replacement; links and devices using those names are refused.

When `--profiles` is omitted, a repeat install refreshes profiles that still exist and removes ownership records for deliberately deleted profiles. Use `--profiles` to restore missing profiles explicitly.

Restoration binds ownership to the inode prepared by the journal, not to matching bytes at the destination. A foreign restored-path replacement or a concurrent state save stops recovery with exact saved state, backups and journal preserved. A legacy copied restore without its preparation-inode proof reports `restored_path_ownership_unproven` and requires reconciliation; it does not invent provenance from the current path. After confirming the reported paths, preserve an unproven destination outside the skill root before retrying recovery from its retained verified backup. Never edit the journal to assert missing ownership.

If `pending_transaction` is true, retain the journal and its backups until recovery finishes. The portable dependency CLI performs recovery only on that invocation, even if recovery removes its own installed files; it loads the manifest first and preserves the requested core-only preference in its result. Review that result before explicitly installing again. Changed untouched originals remain active. A missing or changed restore backup leaves active data unchanged and the error names the journal and surviving recovery paths. Cross-filesystem backup moves record their original quarantine path before moving it. Recovery records a prepared restored inode before publishing it and retains the complete restore backup. Atomic editor saves of originals whose backup never started remain untouched. If cross-filesystem source cleanup fails after a complete backup was published, installation reports the preserved quarantine path; rollback may restore the verified backup while retaining that original-inode partial quarantine for inspection. A foreign quarantine inode or changed restore backup still blocks recovery.

Rollback prepares a verified restore before removing the active replacement, so copy or disk-space errors retain the active files and the original backup. Restore temporary paths and their inode identities are recorded in the journal; interrupted copies can be retried only when their contents still match the backup or its copied prefix. Foreign or edited temporary paths are preserved with an error. Restored core ownership is recorded through a separate rollback-state write, so the next forced update does not require adopting the skill again. That write captures and verifies the earlier state before publishing without replacement; a concurrent state save is preserved and leaves recovery pending. Managed main/profile development links retain their recorded file/directory kind when the previous checkout is absent on Windows. Regular-file activation and restore publication use exclusive hard links and refuse a concurrently created destination; a filesystem without that operation causes a safe failure. Symbolic links are created exclusively with their exact target and recorded kind, then their new inode identity is persisted in the transaction journal before the prepared link is removed. If a process stops after native creation but before that identity is recorded, recovery preserves the link and backups with a pending journal rather than guessing ownership; interruption after persistence can recover automatically. A filesystem that cannot create the symbolic link causes a safe failure with copy-mode guidance. Directory publication still depends on platform rename behavior after an existence check.

Explicit session export selects the newest session whose first valid metadata working directory matches the current project. After selection, it captures each file in a memory buffer of at most 128 MiB, rejects ordinary changes detected during capture, and validates project metadata against the exact captured bytes before creating an exclusive output. Later edits to the source do not alter that snapshot. Parsing metadata uses additional memory; file identity and timestamp checks are not an atomic filesystem snapshot against an arbitrary writer. It parses complete JSONL records even when the first record exceeds 256 KiB. Inspection remains bounded to 10,000 candidate files per provider, 128 MiB per session and 32 directory levels; exceeding those limits stops before any export instead of claiming that the latest session was found. A missing provider directory is treated as absent; access or I/O failures stop selection instead of silently exporting older evidence. If export fails, cleanup verifies the created output's inode, modification metadata and exact written content before removing it. Replaced, edited or unverifiable outputs are preserved and their paths are reported. These checks do not make check-and-unlink atomic against an arbitrary concurrent writer. Exported sessions stay local.

Installation locks are stored under the verified account home in `.proofpilot/install-locks`. Errors include the lock path, PID, hostname and start time. A recorded boot identity allows recovery after a reboot on macOS and Linux. A live-PID lock without that proof, or a lock from another hostname, stays protected: remove it only after verifying that its owner is no longer installing. If recovery cannot prove ownership, preserve the reported paths and choose a new empty skill root rather than deleting active files.

## macOS Catalina (Intel) With Node 18

Node.js 18.20.7 does not meet ProofPilot's or the pinned `@colosseum-org/copilot-connect@0.2.2` helper's Node.js 20+ requirement. The official [Node.js 20 platform table](https://github.com/nodejs/node/blob/v20.x/BUILDING.md#platform-list) lists macOS x64 10.15 as its minimum; [Node.js 22 requires macOS 11](https://github.com/nodejs/node/blob/v22.x/BUILDING.md#platform-list). Node.js 20 is now [end-of-life](https://nodejs.org/en/about/previous-releases), so this is a Catalina compatibility workaround, not a supported LTS setup.

Keep Node.js 18 installed. The following commands create a new private directory in your home, download the official Node.js 20.20.2 Intel archive and verify its [published SHA-256 checksum](https://nodejs.org/dist/v20.20.2/SHASUMS256.txt) **before extraction or execution**. They require no sudo, Homebrew, shell-profile edits or replacement of existing paths. The `&&` chain stops at the first failed step.

```bash
proofpilot_node_dir="$(mktemp -d "$HOME/proofpilot-node20.XXXXXX")" &&
curl --fail --location --proto '=https' --tlsv1.2 \
  'https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-x64.tar.gz' \
  --output "$proofpilot_node_dir/node-v20.20.2-darwin-x64.tar.gz" &&
printf '%s  %s\n' \
  '8be6f5e4bb128c82774f8a0b8d7a1cc1365a7977d9657cece0ca647b3fe04e61' \
  "$proofpilot_node_dir/node-v20.20.2-darwin-x64.tar.gz" |
  shasum -a 256 -c - &&
tar -xzf "$proofpilot_node_dir/node-v20.20.2-darwin-x64.tar.gz" \
  -C "$proofpilot_node_dir" &&
proofpilot_node_bin="$proofpilot_node_dir/node-v20.20.2-darwin-x64/bin" &&
"$proofpilot_node_bin/node" --version &&
"$proofpilot_node_bin/node" \
  "$proofpilot_node_bin/../lib/node_modules/npm/bin/npm-cli.js" --version &&
printf 'Node binary: %s\n' "$proofpilot_node_bin/node"
```

Continue only when the checksum reports `OK`, Node prints `v20.20.2` and npm's version command succeeds. Select this runtime for the **current terminal only**:

```bash
export PATH="$proofpilot_node_bin:$PATH"
node --version
npm --version
```

The full Node path and the explicit npm CLI command above also work without changing `PATH`. An agent started elsewhere may still resolve the old Node.js 18; configure its runtime to the printed Node binary or invoke ProofPilot's scripts with that absolute binary path. Verify the Node version from the agent's own environment before retrying.

For an already copied skill, replace both placeholders with its actual absolute paths and install the 36 supporting skills through its portable helper. The skill root is the parent containing `proofpilot` and its sibling skills; choose the intended runtime's root explicitly.

```bash
"$proofpilot_node_bin/node" \
  "<absolute ProofPilot skill directory>/scripts/install-dependencies.js" \
  --root "<absolute skill root>"
"$proofpilot_node_bin/node" \
  "<absolute ProofPilot skill directory>/scripts/install-dependencies.js" \
  --root "<absolute skill root>" --status
```

An overall `complete` verifies the local support bundle and cached helper, not a Colosseum account connection. Colosseum sign-in is a separate step requiring the user's authorization; follow [onboarding.md](onboarding.md) after installation.

## Standalone Skill Copy Or Skill Manager

A generic skill manager copies `SKILL.md`, references and scripts but does not run dependency hooks. On first use for actual venture/development work, resolve this installed skill's absolute directory and check:

```bash
node "<absolute ProofPilot skill directory>/scripts/install-dependencies.js" --root "<absolute skill root>" --status
```

If `mode` is `core_only`, honor it. If the full bundle is incomplete, briefly explain that ProofPilot is completing its support installation and run:

```bash
node "<absolute ProofPilot skill directory>/scripts/install-dependencies.js" --root "<absolute skill root>"
```

This completion is the narrow installation exception named in [safety.md](safety.md): within the authorized task and host scope it needs no separate approval, but it covers only the manifest's pinned support skills, shared guidance and cached official helper version check. Existing ownership, backup and path checks still apply; it does not include `--update`, other software or any action listed under Action Boundaries.

Every raw stage profile includes its own references and portable scripts. The helper works outside the source repository, including copied or symlinked stage profiles. Honor higher-priority host/user instructions, including an explicit instruction against installing or network access. Inventory-only requests use `discover-sources.js --capabilities` and do not install anything. If downloads are unavailable or a folder collision needs a user's decision, disclose the concrete limitation and continue work that the host can perform; missing guidance does not remove the local implementation route.

`complete` from the dependency helper checks required internal skill files, shared files, local guidance adaptations and the cached helper version. It does not prove account access, toolchain execution or every upstream capability. Online helper preparation uses an owned private working directory and independent empty npm configuration; caller-project packages/configuration do not select its executable. Offline status and version checks create no workspace or npm configuration and do not require a writable home. Login, status and token operations resolve the same protected credential backend. On Windows, executable search and forwarded system-directory values come from matching loaded `ntdll.dll` and `kernel32.dll` locations reported by Node, never caller `SystemRoot`, `WINDIR` or arbitrary runtime directories. Missing or ambiguous system-module evidence leaves system executable search unavailable. A validated cached helper runs login, status and token operations directly without npm or a temporary workspace. Npm is required only for preparation of an absent helper; missing trusted npm produces the specific `EHELPERNPM` prerequisite diagnostic. Online workspaces left by a dead process are reclaimed on a later online preparation. Caller-provided proxies, certificate overrides and credential-shaped environment values are deliberately filtered; installations requiring those network settings need a supported network environment. An absent managed helper is reported as `helper_missing`; run the installed `scripts/setup.js --prepare-colosseum-helper`, then `--status`. Preparation checks only the pinned version, without account inspection, sign-in or support-bundle installation. Unsafe helper/config directory chains produce an `EHELPERENV` diagnostic and stop installation before downloads; repair the reported environment and retry status rather than sign-in. An existing managed helper directory that fails the exact tree, ownership or permission checks is different: it is never executed, repaired or deleted, and repeating sign-in cannot fix it. Setup status reports `helper_untrusted` with `next_action: repair_helper_cache`, the absolute `helper_cache` path and a recovery `diagnostic`; it does not inspect saved account credentials. `--connect-colosseum` refuses before starting sign-in, and dependency status reports `connection_helper.cache_untrusted` with `cache_path` and `recovery` while installation stops before downloads. To recover, preserve that directory: confirm it belongs to your account and is not in use, move the whole directory aside (for example with a `.quarantine` suffix) rather than deleting it, then explicitly run the installed `scripts/setup.js --prepare-colosseum-helper` followed by `--status`. Inspect that state before an authorized sign-in; preparing the helper does not require replacing a saved connection. `discover-sources.js --root "<absolute skill root>" --capabilities` lists all 36 support skills and exact paths without invoking an account or helper process, and reports unusable path types separately.

## Action Boundaries

Installation does not run upstream `install.sh`, setup scripts, telemetry, MCP activation, login, account or settings changes, paid API requests, external AI agents, wallets, project toolchains or final submissions. Installing guidance is not permission to run its workflows; installing `build-with-claude` is only installing guidance; invoking Claude still requires the user's explicit authorization for the current task. Follow [onboarding.md](onboarding.md) for Colosseum sign-in and [safety.md](safety.md) for later actions.
