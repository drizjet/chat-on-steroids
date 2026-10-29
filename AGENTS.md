# Chat On Steroids — operating instructions

This compact file is the repository operating layer. The complete long-form product map and its history live in [docs/AGENT_REFERENCE.md](docs/AGENT_REFERENCE.md). Before a change, read only the relevant owner and contract sections there, then inspect the current implementation and tests. Do not bulk-read the whole reference by default. Treat its dated snapshots as historical until verified against this tree.

## Product and safety invariants

- One meaningful fact has one owner. Other modules may display or transport it, but do not create a second authority.
- Keep local session identity distinct from a replaceable ChatGPT conversation. Mutations and attribution require exact owner evidence; asynchronous results must still match the originating owner and generation. Fail closed when identity is unknown.
- The main process owns local permissions, filesystem and process access, durable state and recorded outcomes. Preload exposes a narrow API; renderer state is presentation, not permission.
- A project association does not grant filesystem access. Current approved roots and live capabilities remain authoritative.
- Preserve user history and unrelated work. Do not add automatic pruning or cleanup without a user-owned deletion contract.
- When custom coordinator safety controls are active, preserve the backend updater guard. A vendor build stays held until a compatible coordinator build has been prepared, reviewed and verified.
- Repair the earliest incorrect identity, decision or ownership boundary. Avoid mirrored state, fallback paths, timers, watchers and unrelated redesigns unless the owning contract requires them.

## Ownership and editing

- `src/main/` owns privileged operations, durable decisions and IPC handlers; `src/preload/index.ts` defines the renderer API; `src/renderer/` owns user interaction and presentation; `src/shared/` owns portable types and schemas; `extension/` owns browser observation and commands.
- Read the owner map in `docs/AGENT_REFERENCE.md` §4 and the feature contract for the subsystem being changed. For cross-layer work, check each participating boundary and its nearest tests.
- Inspect `git status --short` and the diff of every intended file before editing. Preserve shared-tree changes; never reset, clean, broadly reformat or overwrite unrelated work.
- Keep product behavior, tests and documentation aligned. Replace obsolete guidance at its owner instead of appending a conflicting rule.
- Do not edit live AppData ledgers as a source repair. Do not package, install, deploy, restart or publish unless that action is explicitly authorized.

## Validation and shipping

- Executable behavior changes need a targeted regression for the requested outcome and a nearby negative case. Run the nearest affected suites and `npm run typecheck`.
- For production code, run `npm run verify` when the task permits. Renderer or layout changes also need `npm run verify:ui` after a build; report when an authorized scope prevents a check.
- For documentation-only edits, run `git diff --check` and verify links, source citations and any changed factual claims.
- Release validation is separate from source validation. Follow `docs/AGENT_REFERENCE.md` §20 for target builds, native/runtime smoke checks, notices, hashes, privacy/public-history checks and reviewed-tag publishing. Do not infer release readiness from a passing test suite.