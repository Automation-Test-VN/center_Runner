# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Center Runner is a standalone HTTP queue + worker daemon that runs Playwright tools from a **sibling** repo (`../TS_PW_FBC`, configurable). This repo contains **no test framework of its own** — there is no test runner, linter, or build step. The server hands jobs to workers; workers spawn a tool-specific process inside the test repo. Node.js >= 20 is required.

## Commands

```powershell
npm run start              # start the HTTP server (server.mjs) — default 0.0.0.0:4317
npm run worker             # start a worker daemon that long-polls the server forever
npm run worker:once        # process at most one job, then exit (exit 0 = processed, 2 = nothing)
npm run worker:dry-run     # print the command that would run, spawn nothing (--once --dry-run)
npm run update-test-repo   # start the test-repo auto-updater daemon (update-test-repo.mjs)

# point a worker at a specific server (pass args after --):
npm.cmd run worker -- --source http://localhost:4317/api/jobs/next
```

The npm scripts use repo-local `server.env` / `worker.env` for manual development. Operational Windows startup uses `start-server.bat` and `start-workers.bat`, which load external files from `D:\workspace\env` and invoke Node directly. Trace the full batch-to-Node chain before changing env behavior.

## Architecture

Two entrypoints, one shared file-based queue. There is **no database and no message broker** — job state lives entirely as JSON files under `jobs/` (gitignored). Coordination between server and worker is HTTP long-polling.

- `server.mjs` → `src/server/Server.js`: raw `node:http` router (no framework). Serves `public/` static UI, proxies Playwright reports under `/reports/*` from the test repo's `test-results/`, and exposes the `/api/*` job endpoints.
- `worker.mjs` → `src/worker/Worker.js`: polling loop. Long-polls `GET /api/jobs/next`, spawns the tool-specific child process against the current `TEST_REPO_ROOT` checkout, then posts completion and report data.
- `update-test-repo.mjs` → `src/updater/RepoUpdater.js`: a separate, optional daemon (not run by `Worker.js`). It polls on an interval and runs `git pull --ff-only` in `TEST_REPO_ROOT` only when `jobs/running/` is empty, so the checkout never mutates under an in-flight test. `Worker.js` itself no longer pulls or locks the checkout — this was changed deliberately so multiple workers can run jobs fully in parallel instead of serializing on a shared per-checkout lock. `start-workers.bat` launches this daemon automatically alongside the workers.

### The job lifecycle (file-queue state machine)

A job is a JSON file named `<jobId>.json` that physically moves between directories as its status changes. Job id patterns are centralized in `src/common/JobId.js`: aliveDaily uses `AL-YYYYMMDD-HHMMSS-brand-XX`, and checkAccess uses `CA-YYYYMMDD-HHMMSS-XX-ISP`. A checkAccess Start fans out to **one job per selected ISP (nhà mạng)**, all sharing one base id (`CA-YYYYMMDD-HHMMSS-XX`) with a different ISP suffix; the ISP is chosen at creation time and is part of the queue/report id (the worker no longer appends it).

```
POST /api/jobs      → jobs/queue/<id>.json      (status QUEUED)
GET  /api/jobs/next → fs.rename to jobs/running/ (status RUNNING)   ← atomic claim
POST /api/jobs/complete → jobs/results/<id>.json (DONE|FAILED), queue+running copies deleted
```

Key mechanics to preserve:
- **Claiming is `fs.rename`** (`JobManager.claimNextJob`). The rename is the concurrency lock: whichever worker's rename succeeds owns the job; `ENOENT`/`EEXIST`/`EPERM` mean another worker won the race, so it tries the next file. Never replace this with read-then-write.
- **Queue order is FCFS by `createdAt`, not filename**: `claimNextJob` reads each queued file's `createdAt` (`JobManager.sortQueuedFilesByCreatedAt`) and sorts ascending before claiming, so job ids from different tools (`AL-*` vs `CA-*`) interleave by actual creation time instead of by alphabetical prefix.
- **All writes are write-temp-then-rename** (`JobManager.writeJsonFile`) to avoid torn reads. Keep this pattern for any new job-file writes.
- **Long-polling**: if the queue is empty, `WorkerRegistry` holds the HTTP response open (default 60s, `CENTER_RUNNER_WORKER_WAIT_TIMEOUT_MS`) and replies `204` on timeout. `POST /api/jobs` calls `workerRegistry.notifyAll()` to immediately hand the new job to a waiting worker.
- **Duplicate guard**: `addJob` rejects (HTTP 409) a job whose command matches an already active (queued/running) job — `{tool,group,brand,tag}` for aliveDaily, `{tool,tag,isp}` for checkAccess (so different ISPs of one Start are not treated as duplicates).
- **ISP routing**: `claimNextJob(workerIp, workerName, workerIsp)` filters candidates via `workerCanRun` — aliveDaily jobs (no ISP) may be claimed by any worker, but a checkAccess job is bound to its ISP and only a worker whose `WORKER_ISP` matches can claim it. A worker with no ISP set can only run aliveDaily. `WorkerRegistry.notifyAll` applies each waiter's own ISP filter and leaves non-matching waiters waiting instead of ending the loop.
- **Queue TTL / EXPIRED**: a periodic maintenance sweep (`Server.startMaintenanceLoop`, `config.maintenanceIntervalMs`) marks any QUEUED job older than `config.queueTtlMs` as `EXPIRED` (`JobManager.expireStaleQueuedJobs`) — e.g. a checkAccess ISP with no matching worker online — using the same atomic `fs.rename` claim so it never races a worker. The sweep also prunes long-dead workers from the presence roster.
- **Worker presence**: `WorkerPresence` records each worker reactively on every `/api/jobs/next` poll (the poll is the heartbeat — no separate timer). `GET /api/workers` returns `{name,ip,isp,online,lastSeen}` (online = polled within `config.workerOnlineWindowMs` **or** currently running a job); `GET /api/isps` returns the distinct online ISPs that drive the checkAccess ISP checkboxes. Status is computed on read, so the panel stays fresh independent of the sweep.
- **Worker idempotency**: each worker records the last job identity in a per-worker `jobs/worker-state-<name>.json` and skips re-processing the same identity.
- **Job id registry**: create ids with `createJobIdForTool(tool, { brand, date })`; validate queue/result ids with `isValidJobId()` / `isValidJobFileName()`. When adding a new tool, add its pattern, format label, and generator to `JOB_ID_CONFIG_BY_TOOL` before changing queue, route, or report behavior.

### The validation contract

AliveDaily uses `{ tool, group, brand, tag }`; checkAccess uses `{ tool, tag, isp }`. Command rules are validated in both server creation and the live worker path. Keep duplicated helper validation aligned when these contracts change.

The job-id and report contract is shared with `../TS_PW_FBC`. AliveDaily forwards `--job-id` and `JOB_ID`; checkAccess uses `JOB_ID` with `REPORT_SCOPE=checkAccess`. The `JOB_ID` handed to Playwright is the full checkAccess id **including its ISP suffix**; `../TS_PW_FBC` treats `JOB_ID` as an opaque token (path-safe only), so a change to the id format needs no change there. Update validation, report routing, docs, skills, and references when this contract changes.

The worker builds one of these fixed command families and never executes arbitrary browser input (`Worker.buildRunner`):
```
aliveDaily:  node <testRepoRoot>/scripts/run-domain-test.mjs <group> <brand> --grep <tag> --job-id <jobId>
checkAccess: npm run check:access (through cmd.exe on Windows)
```

### IMPORTANT: partially wired OOP artifacts

`src/common/Job.js` now shares job id/report helpers from `src/common/JobId.js`, but runtime server job creation still happens in `JobManager.buildJob`. `src/worker/JobFetcher.js` and `src/worker/JobRunner.js` remain defined but not imported by the live worker loop. The live logic they appear to own is actually inlined:
- Job creation / validation / queue writes -> `JobManager` (server) and `src/common/JobId.js` (id/report helpers).
- Job fetching + runner spawning → inlined in `Worker` (`readJob`, `readRemoteJob`, `buildRunner`).

When fixing runtime behavior, verify whether the path is live before editing model/helper classes; don't be misled by older flow diagrams.

## Configuration

All config funnels through two files — never read `process.env` elsewhere:
- Server vars → `src/common/Config.js` (exports a single `config` object).
- Worker vars → `src/worker/WorkerConfig.js` (parses CLI args in addition to env; CLI overrides env).

Adding a config value requires 4 edits (see README "Adding a new config variable"): `.env`, `.env.example`, the Config/WorkerConfig class, then consume it via `config.x`. Adding it to `.env` alone does nothing.

`CENTER_RUNNER_TEST_REPO` (or `TEST_REPO_ROOT`) points at the sibling Playwright repo and defaults to `../TS_PW_FBC`. Reports and the runner script both live in that repo, not here.

## Frontend

`public/app.js` is a vanilla-JS Page Object Model (no build, no framework): `RunnerForm`, `JobTable`, `JobSummary`, `ReportViewer`, `AppController`. It polls the `/api/*` endpoints. Follow the existing class-per-view pattern; do not add procedural globals (this is also enforced by `.codex/skills/center-runner-web/`).

## Deployment

Two batch files at the project root (`start-server.bat`, `start-workers.bat`) handle setup and launch on cmd.exe. Server binds `0.0.0.0` for LAN/Tailscale access. See README for LAN/Tailscale setup.

`start-workers.bat` requires `WORKER_COUNT` to be present in the worker env file it loads (`WORKER_ENV_FILE`, e.g. `D:\workspace\env\worker.env`) — it now exits with `[ERROR]` instead of silently defaulting if the key is missing. The worker-index loop variable (`I`) is unrelated to the total worker count; only `WORKER_COUNT` controls how many `cmd` windows get launched. The batch file also starts `update-test-repo.mjs` in its own window before launching workers.
