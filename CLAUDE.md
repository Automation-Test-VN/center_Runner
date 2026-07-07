# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Center Runner is a standalone HTTP queue + worker daemon that runs Playwright "domain tests" from a **sibling** repo (`../TS_PW_FBC`, configurable). This repo contains **no test framework of its own** — there is no test runner, linter, or build step. The server hands jobs to workers; workers `spawnSync` a script inside the test repo. Node.js >= 20 required (uses native `fetch`, `--env-file`).

## Commands

```powershell
npm run start            # start the HTTP server (server.mjs) — default 0.0.0.0:4317
npm run worker           # start a worker daemon that long-polls the server forever
npm run worker:once      # process at most one job, then exit (exit 0 = processed, 2 = nothing)
npm run worker:dry-run   # print the command that would run, spawn nothing (--once --dry-run)

# point a worker at a specific server (pass args after --):
npm.cmd run worker -- --source http://localhost:4317/api/jobs/next
```

Every script uses `node --env-file=.env`, so a `.env` file must exist (`Copy-Item .env.example .env`). There is no "run a single test" here — a single test *is* one job (`worker:once`), or a single Playwright run inside `../TS_PW_FBC`.

## Architecture

Two entrypoints, one shared file-based queue. There is **no database and no message broker** — job state lives entirely as JSON files under `jobs/` (gitignored). Coordination between server and worker is HTTP long-polling.

- `server.mjs` → `src/server/Server.js`: raw `node:http` router (no framework). Serves `public/` static UI, proxies Playwright reports under `/reports/*` from the test repo's `test-results/`, and exposes the `/api/*` job endpoints.
- `worker.mjs` → `src/worker/Worker.js`: polling loop. Long-polls `GET /api/jobs/next`, runs the job via `spawnSync(node, run-domain-test.mjs ...)` in the test repo, then `POST /api/jobs/complete`.

### The job lifecycle (file-queue state machine)

A job is a JSON file named `CR-YYYYMMDD-HHMMSS-XXXX.json` that physically moves between directories as its status changes:

```
POST /api/jobs      → jobs/queue/<id>.json      (status QUEUED)
GET  /api/jobs/next → fs.rename to jobs/running/ (status RUNNING)   ← atomic claim
POST /api/jobs/complete → jobs/results/<id>.json (DONE|FAILED), queue+running copies deleted
```

Key mechanics to preserve:
- **Claiming is `fs.rename`** (`JobManager.claimNextJob`). The rename is the concurrency lock: whichever worker's rename succeeds owns the job; `ENOENT`/`EEXIST`/`EPERM` mean another worker won the race, so it tries the next file. Never replace this with read-then-write.
- **All writes are write-temp-then-rename** (`JobManager.writeJsonFile`) to avoid torn reads. Keep this pattern for any new job-file writes.
- **Long-polling**: if the queue is empty, `WorkerRegistry` holds the HTTP response open (default 60s, `CENTER_RUNNER_WORKER_WAIT_TIMEOUT_MS`) and replies `204` on timeout. `POST /api/jobs` calls `workerRegistry.notifyAll()` to immediately hand the new job to a waiting worker.
- **Duplicate guard**: `addJob` rejects (HTTP 409) a job whose `{tool,group,brand,tag}` command matches an already active (queued/running) job.
- **Worker idempotency**: each worker records the last job identity in a per-worker `jobs/worker-state-<name>.json` and skips re-processing the same identity.

### The validation contract (duplicated — keep in sync)

The command shape `{ tool: "aliveDaily", group: "fbc\d+", brand: "[a-z0-9-]+", tag: "@..." }` is validated with the **same regexes in multiple places**: `JobManager.buildJob` (server, on submit) and `Worker.validateCommand` (worker, before spawn). If you change a validation rule, change it in both. `tool` currently only supports `aliveDaily`.

The worker always spawns exactly this, never arbitrary shell (`Worker.buildRunner`):
```
node <testRepoRoot>/scripts/run-domain-test.mjs <group> <brand> --grep <tag>
```

### IMPORTANT: unwired OOP artifacts

`src/common/Job.js`, `src/worker/JobFetcher.js`, and `src/worker/JobRunner.js` are **defined but not imported anywhere**. They are leftovers from an OOP refactor. The live logic they appear to own is actually inlined:
- Job model / validation / ID generation → inlined in `JobManager` (server) and `Worker` (worker).
- Job fetching + runner spawning → inlined in `Worker` (`readJob`, `readRemoteJob`, `buildRunner`).

Editing these three files changes nothing at runtime. When fixing behavior, edit `JobManager.js` / `Worker.js`; don't be misled by the README's flow diagrams, which describe the intended (not current) wiring.

## Configuration

All config funnels through two files — never read `process.env` elsewhere:
- Server vars → `src/common/Config.js` (exports a single `config` object).
- Worker vars → `src/worker/WorkerConfig.js` (parses CLI args in addition to env; CLI overrides env).

Adding a config value requires 4 edits (see README "Adding a new config variable"): `.env`, `.env.example`, the Config/WorkerConfig class, then consume it via `config.x`. Adding it to `.env` alone does nothing.

`CENTER_RUNNER_TEST_REPO` (or `TEST_REPO_ROOT`) points at the sibling Playwright repo and defaults to `../TS_PW_FBC`. Reports and the runner script both live in that repo, not here.

## Frontend

`public/app.js` is a vanilla-JS Page Object Model (no build, no framework): `RunnerForm`, `JobTable`, `JobSummary`, `ReportViewer`, `AppController`. It polls the `/api/*` endpoints. Follow the existing class-per-view pattern; do not add procedural globals (this is also enforced by `.codex/skills/center-runner-web/`).

## Deployment

`jenkins/*.bat` + `center-runner-worker.Jenkinsfile` run workers on a test machine, injecting a secret `TS_PW_FBC/.env` from a Jenkins `Secret file` credential (`ALL_DOMAINS_ENV_FILE`). Server binds `0.0.0.0` for LAN/Tailscale access. See README for LAN/Tailscale/Jenkins setup.
