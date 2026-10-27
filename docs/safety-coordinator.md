# Existing Windows coordinator integration

This optional integration uses the existing coordinator registry and Windows named mutex.
It does not create a command service or change Windows ACLs.

The local configuration enables it with `coordinator: { enabled: true, root: <absolute pilot folder>, autoRegisterSessions: true, protectUpdates: true }`.
Do this only after backing up configuration and installing the matching app build during a
controlled restart. An unmodified running app does not acquire these protections merely
because configuration or source files were changed.

The native Windows helper owns `Local\CoS-Desktop-Input` across an entire input transaction,
including focus, clipboard publication, input, verification and capture. Contention refuses
input before effects. The transaction token must match at release; a dead helper abandons the
OS mutex, and the next helper recovers it. The existing pilot lease uses the same mutex.
Background browser DOM operations remain independent of physical desktop input.

Core path resolution checks local canonical paths against `agents/*.json` in the pilot.
A registration may map its `Principal` to the app's internally proven `session:<id>` principal,
or provide `SessionId`. Identity is derived by the app, never accepted as a tool argument.
Unregistered callers are recorded and warned; they do not acquire another registration's identity.
Cross-folder reads and writes outside registered workspaces remain possible with warning/audit.
The central pilot `WORKSPACE_POLICY.json` may declare `SharedRoots` as an array of absolute
paths. Those root folders cannot have one exclusive owner; project subdirectories beneath
them still can. Historical registrations of a shared root remain on disk for provenance but
are ignored by both the app and PowerShell policy. A learned shared root is also excluded
from automatic enrollment, so another project's subdirectory can be enrolled independently.
Writes into another registered workspace require the tool's optional `workspace_policy`:

```json
{
  "acknowledge_cross_workspace": true,
  "reason": "Update the agreed shared artifact",
  "read_paths": ["C:\\collaboration\\reference.txt"],
  "write_paths": ["C:\\collaboration\\shared.txt"]
}
```

`apply_patch`, `save_image`, and `exec_command` expose this object. Patch source and move
destinations are checked before mutation. Command working directories and declared target
paths are checked before process allocation. Command children are trusted after launch;
derived or undeclared paths, hard links, reparse-point races, external plugins and execution
tools outside this app are not a filesystem sandbox. Declare script/config-derived targets.
Do not certify universal cross-agent write prevention from these preflight checks.

`TOOL_POLICY_AUDIT.jsonl` records operation identity, argument digests, path preflights and
completion/failure. `GUI_INPUT_AUDIT.jsonl` records acquired/released native transactions.
No command text, typed text or clipboard contents are added to these coordinator logs.

Migration must record process creation time, durable app session identity, workspace,
registration, execution route and rollback. A running external process cannot be safely
reparented into a Job Object or made to use the app's tools by registering its PID. Reuse or
relaunch owned agents deliberately, verify collisions in disposable workspaces, and list
every ungoverned execution route before claiming full coverage.

## Session enrollment and multiple writers

With `autoRegisterSessions`, a verified session's project/learned workspace is enrolled before
file writes, and its explicit command workspace before launching a command. Enrollment calls
the existing PowerShell registration owner and its Windows mutex; it does not create a second
registry or invent identity from a chat title. An exact late request correlation can recover
the durable session. Unproven callers and approved umbrella roots are never automatically
enrolled. Each session may own multiple disjoint workspaces. A competing registration is
re-read before the write gate decides; simultaneous callers cannot both claim the same path.

Existing chats keep their folders. When two chats share one registered folder, the second
writer receives the ordinary acknowledgement gate. This does not relocate existing work.
`multiAgent.autoWorktrees` uses CoS's existing managed-worker worktree implementation for
new allocations. It does not isolate unrelated prime chats or migrate existing workers.
An unfiled chat's first absolute write also enrolls its nearest existing target folder when
there is no narrower proven workspace. This avoids a first-write gap after a broad root was
learned during patch resolution. Approved umbrella roots remain excluded.

## Update compatibility and live proof

`protectUpdates` preserves the custom safety build: newer vendor releases are discovered,
but downloading/installation is deferred with `COORDINATOR_UPDATE_REVIEW_REQUIRED`. The
explicit install and final quit-time handoff both recheck the setting. This is an intentional
tradeoff: compatible safety changes must be rebased and validated before applying a vendor
release, including any security fixes. External installers can still replace the app.
This compatibility hold does not enter the rapid network-failure retry schedule. Explicit
refresh and ordinary periodic version checks remain available.

The authenticated `/v1/status` includes a `safetyCoordinator` receipt with its build marker,
enabled state, enrollment and update-guard flags. It publishes no registry path or identities.
It includes a digest of the configured registry root. Preflight compares that digest with
saved configuration, so an external root edit cannot falsely certify an old running registry.
`node scripts/coordinator-preflight.mjs` checks the actual installed package, saved config,
registry counts, native helper files and live receipt. Deployment creates
`COORDINATOR_COMPONENTS.json` in the pilot root with the build marker and SHA-256 of
`CoS-Agent.ps1`, `CoS-WorkspacePolicy.ps1`, `CoS-GuiLease.ps1` and
`hardened-canary/CoS-JobRunner.cs`. Missing or changed helpers, or a missing/invalid receipt,
degrade the result. This receipt detects accidental drift; it is not a signed trust boundary
against another process with the same Windows account.
The archive stager requires a new directory beneath an existing parent and refuses
an existing destination before reading payloads, including the installed resources folder.
The checker returns exit code 2 for degraded coverage and never equates a live tunnel or
enabled setting with protection. `--offline` returns `configured-offline` after static checks,
not `ready-cooperative`; it does not certify runtime activation. `--app`, `--data` and `--root`
support isolated fixtures. Neither static hashes nor a live receipt prove a new tool action.
