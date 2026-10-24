# Windows shell resume experiment

Fork: https://github.com/lennix1337/PiG
Base: upstream v0.5.2 (07a8631fb54a6a1e8a0f463dc4998cb7aff6ac40).
Scope: local experimental binary only; do not replace installed Pi/PiG, publish changes, or call external inference.

## Acceptance and evidence

- Build original and modified source with the same Go toolchain and flags.
- Replace system-wide thread enumeration with direct process resume while retaining suspended creation, job assignment, tree cleanup, and kill-on-resume-failure behavior.
- Verify the real resume path, invalid/dead process failure, cancellation, timeout, output completion, and descendant termination. Test failures and unrun gates remain explicit.
- Compare Pi 1.4.0, original PiG, and modified PiG using rotating processes, identical local mock responses and real read/edit/read-back/bash calls. Verify identical files, results, and no external inference; report medians and samples, not guaranteed gains.
- Report tool time separately from total flow; measure only empty-profile RPC behavior, not extension compatibility, reasoning or production performance.

## State

Local branch: `experiment/windows-resume`. Existing installed agents remain untouched. Two production changes: replace system-wide thread enumeration with direct NtResumeProcess (already used in PiG's extension subprocess host), and capture descendant handles before taskkill so cancellation/timeout waits for exiting members. The latter defect was red-proven in original source.

Verified: 21 Windows safety tests and two nested descendant-cancel/timeout cases; isolated original/modified builds with Go 1.27.3; focused resume benchmark/profiles; affected-package go vet; kill-on-failed-resume mutation fails the regression and restored source passes. Git diff-check passes.

Six rotating process trios, 90 measured flows, identical outputs, 432 real tool calls including warmup, local provider only:

| Median | Pi 1.4.0 | Original PiG | Modified PiG |
|---|---:|---:|---:|
| Four-tool flow | 70.44 ms | 96.25 ms | 63.29 ms |
| Bash | 57.62 ms | 89.80 ms | 56.99 ms |
| Main-process RSS | 158.23 MiB | 39.80 MiB | 39.77 MiB |

Modified PiG is 10.15% faster than Pi and 34.24% faster than original PiG in this empty-profile RPC workload. Each of the six paired process medians favored modified PiG. This does not establish extension compatibility, reasoning quality, or full-setup performance.

Not verified: full repository/parity/race/lint gates, other Windows versions, full user setup. Ripwire edit-check/quality timed out at the native limit; test-gate reports unresolved coverage (exit 4). No claim of merge/release readiness.

Full report, raw samples, hashes and CPU/allocation profiles: `C:/projetos/local-validation/performance/pi-pig-tools/FORK-REPORT.md` and `fork-paired-6/`. Runtime evidence stays outside Git. The two Go changes and their Windows tests are published on the fork branch `experiment/windows-resume` (`52d5ae28`, signed-off but unsigned; not proposed for main). This document and `.pi/` recipes stay local because they contain machine paths and private setup details.

## Second experiment: explicit direct-shell configuration

The next bottleneck was the Git `bin/bash.exe` launcher. Selecting `usr/bin/bash.exe` through the existing `shellPath` setting, with explicitly prepared wrapper environment, reduced the native paired run from **63.01 ms to 54.95 ms** (Pi: **69.98 ms**): 12.79% less flow time than the first fork and 21.48% less than Pi. Six rotating trios/90 measured flows, matching output hashes, no external model requests. The same PiG binary is used in both configurations; no further production patch or default change was made.

One-time setup/environment verification cost: **107.97 ms**, excluded from warm flow and recorded separately. This is an optional configuration experiment, not a transparent production launcher: extra setup invokes shells, arbitrary BASH_ENV side effects and mid-session environment changes are not proven equivalent. Live settings remain untouched. Startup scripts, EXEPATH, PATH, HOME and Git configuration must not be silently bypassed for a default optimization.

Verified: complete child-environment equivalence in seven fixtures and 49 paired command comparisons; native-launch EXEPATH regression caught and fixed in preparation; safety tests extended to launcher/direct cancellation and timeout (21 top-level tests and four descendant cases). Real Go executor/profile: launcher 57.35 ms/op versus direct 48.46 ms/op, with allocation and CPU profiles. Affected-package vet passed. Broad repo/parity/race/lint gates and full setup remain unverified.

Recipes: `direct-contract`, `direct-profile`, `direct-benchmark`; source scripts in `.pi/`; full evidence and limitations in `C:/projetos/local-validation/performance/pi-pig-tools/DIRECT-SHELL-REPORT.md`. Canonical measurement: `direct-shell-native-455064af-df33-489e-b766-38030140b22f/`. The resume-only defaults and earlier benchmark binaries remain preserved. No commit/push/installation change.

## Current-extensions comparison (requested next)

The user requested both current Pi and the configured experimental PiG with all installed extensions. Compatibility/startup must be checked before timing a tool flow: nine configured packages, exact current entries, isolated homes/auth/history, no external model requests. PiG process-tree RSS must include its Node extension host, not just the Go process. Successful startup alone does not validate extension functionality, authenticated failover, TUI, voice or real compaction. Do not call a reduced extension set equivalent.

Probe: `C:/projetos/local-validation/performance/pi-pig-tools/extensions-compat.mjs`. Initial run `extensions-current-compat-1/` was invalid: backslashes in NODE_OPTIONS preload were parsed away, preventing both hosts from starting. Normalized forward-slash preload verified, and corrected `extensions-current-compat-2/` loaded all nine packages in both runtimes, matching 45 registered tools and 50 command names, no stderr or recorded external connection attempts. One compatibility sample: Pi startup ~1.13s / process-tree RSS ~254 MiB; PiG ~7.15s / ~797 MiB (includes its Node host). These are isolated RPC measurements, not full feature compatibility.

`compare-all-extensions.mjs` replays the same four real tools with all nine loaded, live defaultTools/shellCommandPrefix, isolated auth/models/history, identical Node runtime and verified direct-shell environment for PiG. The first flow smoke failed an incorrect harness assumption that RPC hasUI=false; both hosts expose extension UI requests, not rendered TUI. Corrected `extensions-flow-smoke-2/` completed both runtimes with identical outputs. Six alternating pairs in `extensions-paired-6/` finished and passed independent verification: 12 processes, 60 measured flows, 288 tool executions including warmups, 360 local mock requests, identical final hashes. Both extension hosts use Node 24.21.0 and have the network guard loaded. Median flow: Pi 448.06 ms, configured PiG 630.09 ms (PiG 40.63% slower in every paired process median); startup 1.11s vs 7.06s; final summed tree RSS 301.23 vs 805.92 MiB. This includes the current shellCommandPrefix, unlike the earlier empty-profile run. It establishes a reversal for this extension-loaded mock workload, not its cause. Source/binary entry and live config/auth hashes unchanged.

Additional discovery: `~/.pi/agent/extensions/ai-memory-pi.ts` is a local hook outside the nine packages. A separate `compare-all-with-hook.mjs` attempts to load it too, intercepting the memory service with synthetic /hook, /handoff and empty MCP catalogue responses. First attempt `extensions-with-hook-paired-6/` failed because no fixture calls were recorded; Pi core's HTTP dispatcher can replace the preload fetch wrapper. No equivalence or no-service-contact claim is made for that attempt. Updated interception survives fetch replacement and rejects raw sockets to port 49374 independently. `extensions-with-hook-probe-2/` passed one pair: synthetic bootstrap tools/list, session-start/user-prompt/pre-tool-use/post-tool-use/stop and handoff calls were all observed in both runtimes; the memory backend and tool catalogue are NOT real. Six alternating pairs finished in `extensions-with-hook-final-6/` (shell `740892ce-d6dc-444a-9f7f-d95c64e98e38`, exit0); independent `verify-with-hook.mjs` passed. Manifest/source/config/auth hashes unchanged; both Node hosts use 24.21.0. 12 processes, 60 measured flows, 288 real tool executions including warmup, 360 local mock requests, identical output hash. Median Pi/PiG: flow 929.69/1129.54 ms, startup 1167.69/7227.41 ms, final summed tree RSS 297.41/1039.18 MiB. PiG is 21.50% slower, losing all six pairs; setup108.47ms excluded and separately recorded. All nine packages plus actual local hook loaded, but the hook's memory service and empty tool catalogue are simulated, not production-validated. Both final comparisons together cover120 measured flows/576 tool calls/720 local mock requests and agree that the empty-profile speedup does not survive the extension-loaded workload. Report finalized at `C:/projetos/local-validation/performance/pi-pig-tools/EXTENSIONS-REPORT.md`. No migration recommended from this evidence; extension feature compatibility, real OptChat history/compaction, TUI, voice, authenticated failover and native MCP remain not verified. Do not touch live memory/auth/history or infer backend validation. No migration or production settings changes authorized by this test.

## Reproduce locally

Inspect `.pi/checks.json` and `.pi/windows-experiment.ps1` before running named `safety`, `failure-guard`, `vet`, and `build` checks. Original binary and baseline profiles are preserved externally; do not run `baseline-resume` on modified source and call it baseline.

Use `node .pi/compare-windows-resume.mjs <fresh-output-directory> 6` to replay against the preserved binaries and Pi 1.4.0. Read the script's fixed binary paths first. This uses isolated profiles and a local mock provider, not paid inference.
