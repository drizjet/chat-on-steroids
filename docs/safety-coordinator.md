# Existing Windows coordinator integration

This optional integration uses the existing coordinator registry and Windows named mutex.
It does not create a command service or change Windows ACLs.

The local configuration can enable it with `coordinator: { enabled: true, root: <absolute pilot folder> }`.
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
