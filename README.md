# Center Runner

Standalone web queue and worker for running TS_PW_FBC domain tests.

## Codebase Layout

* [server.mjs](./server.mjs): Entrypoint for bootstrapping the Server.
* [worker.mjs](./worker.mjs): Entrypoint for starting the Worker daemon.
* [src/](./src/): Core OOP modules split into layers:
  * [common/Config.js](./src/common/Config.js): Configuration and path setup.
  * [common/Job.js](./src/common/Job.js): Job model and serialization.
  * [common/JobId.js](./src/common/JobId.js): Tool-specific job id patterns, generators, validators, and report URL helpers.
  * [server/Server.js](./src/server/Server.js): HTTP router and static report server.
  * [server/JobManager.js](./src/server/JobManager.js): Filesystem job queue and result storage manager.
  * [server/DomainChecker.js](./src/server/DomainChecker.js): Preflight domain checking.
  * [server/WorkerRegistry.js](./src/server/WorkerRegistry.js): Workers queue and long polling manager.
  * [worker/Worker.js](./src/worker/Worker.js): Worker loop orchestrator.
  * [worker/WorkerConfig.js](./src/worker/WorkerConfig.js): Worker CLI argument parsing.
  * [worker/JobFetcher.js](./src/worker/JobFetcher.js): Job retriever (URL/File).
  * [worker/JobRunner.js](./src/worker/JobRunner.js): Playwright runner validation and child process spawner.
* [public/](./public/): Frontend UI files, using Page Object Model (POM) in [app.js](./public/app.js).
* [.codex/skills/center-runner-web/](./.codex/skills/center-runner-web/): AI guidelines for center runner.

## Core Flows & Architecture

The codebase operates on an OOP/POM event-driven file queue.

### Core Flows Summary

1. **Server Initialization**: Startup flow begins at [server.mjs](./server.mjs) which instantiates and launches the [Server.js](./src/server/Server.js) class.
2. **Task Creation**: When the user clicks **Start** on the UI ([app.js](./public/app.js)), [JobManager.js](./src/server/JobManager.js) validates the command, creates a tool-specific job id via [JobId.js](./src/common/JobId.js), and writes the job JSON file to the queue directory.
3. **Task Receiving**: Worker daemon fetches new jobs via long-polling from the server, coordinated by [WorkerRegistry.js](./src/server/WorkerRegistry.js) and [JobFetcher.js](./src/worker/JobFetcher.js).
4. **Task Running**: Once received, the worker calls [JobRunner.js](./src/worker/JobRunner.js) to run the Playwright test suite via a child process (`spawnSync`), then reports the status (`DONE` or `FAILED`) back to the server.
5. **Report Serving & Viewing**: The UI page object [JobTable](./public/app.js) displays an **Open** button which loads the generated static HTML report from the sibling workspace into a preview iframe using [ReportViewer](./public/app.js).

---

### Detailed Flows

### 1. Server Initialization
* **Files involved**: [server.mjs](./server.mjs), [Server.js](./src/server/Server.js), [Config.js](./src/common/Config.js)
* **Flow**:
  * Running `npm run start` runs `server.mjs`, which instantiates and starts the `Server` class.
  * The server reads environment configurations from `Config` and starts listening on the designated host and port (default `0.0.0.0:4317`).
  * On startup, it ensures directories (`jobs/queue`, `jobs/running`, `jobs/results`) exist.

### 2. Task Creation
* **Files involved**: [app.js](./public/app.js) (`RunnerForm`, `AppController`), [Server.js](./src/server/Server.js) (`POST /api/jobs`), [JobManager.js](./src/server/JobManager.js) (`addJob()`), [JobId.js](./src/common/JobId.js)
* **Flow**:
  * The user fills out parameters in the browser form and clicks **Start**; `RunnerForm` captures inputs and `AppController` makes a POST request to `/api/jobs`.
  * The server parses this request, instantiates a `Job`, checks for active duplicate jobs, saves the job definition to `jobs/queue/<jobId>.json`, and triggers `WorkerRegistry.notify()` to alert any waiting workers.

### Job ID Contract

Job ids are tool-specific. The shared contract lives in [src/common/JobId.js](./src/common/JobId.js); do not duplicate regexes in server code.

| Tool | Pattern name | Format |
|---|---|---|
| `aliveDaily` | `ALIVE_DAILY_JOB_ID_PATTERN` | `AL-YYYYMMDD-HHMMSS-brand-XX` |

The server creates ids with `createJobIdForTool(tool, { brand, date })`. Queue files use `<jobId>.json`, and result/report lookups validate with `isValidJobId()` so future tool patterns can be added in the same registry. When adding a new server tool, add its pattern, format label, and generator to `JOB_ID_CONFIG_BY_TOOL` before wiring queue or report routes.

### 3. Task Receiving
* **Files involved**: [Server.js](./src/server/Server.js) (`GET /api/jobs/next`), [WorkerRegistry.js](./src/server/WorkerRegistry.js), [JobFetcher.js](./src/worker/JobFetcher.js), [JobManager.js](./src/server/JobManager.js) (`claimNextJob()`)
* **Flow**:
  * The worker calls `JobFetcher.fetchJob()` pointing to `/api/jobs/next`.
  * If a job is queued, `JobManager.claimNextJob()` moves the JSON file from `jobs/queue/` to `jobs/running/`, sets its status to `RUNNING`, and returns the job to the worker.
  * If the queue is empty, `WorkerRegistry` holds the request connection open (long-polling) with a timeout of 60 seconds until a new job is added.

### 4. Task Running
* **Files involved**: [worker.mjs](./worker.mjs), [Worker.js](./src/worker/Worker.js), [JobRunner.js](./src/worker/JobRunner.js)
* **Flow**:
  * Once the worker fetches a job, `Worker.js` verifies it and calls `JobRunner.run()`.
  * `Worker.js` passes the job id to `scripts/run-domain-test.mjs` as both `--job-id <jobId>` and the `JOB_ID` environment variable.
  * `JobRunner` validates arguments and executes Playwright tests via `spawnSync` using `scripts/run-domain-test.mjs` located in the sibling `TS_PW_FBC` workspace.
  * When execution finishes, `Worker.js` posts results (`DONE` or `FAILED`) back to the server via `POST /api/jobs/complete`.
  * The server's `JobManager.completeJob()` updates the job status JSON, moves it to `jobs/results/`, deletes the temporary queue/running files, and syncs the active job state.

### 5. Report Serving & Displaying
* **Files involved**: [Server.js](./src/server/Server.js) (`GET /reports/*`), [app.js](./public/app.js) (`ReportViewer`, `JobTable`), [Config.js](./src/common/Config.js)
* **Flow**:
  * Playwright saves job-scoped test results to `TS_PW_FBC/test-results/<brand>/<jobId>/report.html` when `JOB_ID` is present, and falls back to `TS_PW_FBC/test-results/<brand>/report.html` for local runs without a job id.
  * The server routes any requests under `/reports/*` to serve these HTML assets statically from `Config.testResultsDir`.
  * When a job completes, the UI `JobTable` renders an **Open** button which maps to `ReportViewer.load()`, embedding the static report inside the preview iframe.



## Configure via `.env`

Each role loads its own env file so the server and worker never clobber each
other's config, even on the same machine:

* `npm run start` → `node --env-file=server.env` (see `server.env.example`)
* `npm run worker` → `node --env-file=worker.env` (see `worker.env.example`)

Copy the matching template and fill in values for your machine before running
anything (Node.js ≥ 20.6 — no dotenv needed):

```powershell
Copy-Item server.env.example server.env   # on the server machine
Copy-Item worker.env.example worker.env   # on the worker machine
```

### Server env vars (`npm run start`)

| Variable | Default | Description |
|---|---|---|
| `CENTER_RUNNER_PORT` | `4317` | HTTP port the server listens on |
| `CENTER_RUNNER_HOST` | `0.0.0.0` | Host binding |
| `CENTER_RUNNER_TEST_REPO` | `../TS_PW_FBC` | Path to the Playwright test repo |
| `CENTER_RUNNER_WORKER_WAIT_TIMEOUT_MS` | `60000` | Long-poll timeout in ms |

### Worker env vars (`npm run worker`)

| Variable | Default | Description |
|---|---|---|
| `WORKER_IP` | `127.0.0.1` | IP of this worker machine |
| `WORKER_NAME` | `worker-{ip}` | Display name of this worker |
| `CENTER_RUNNER_IP` | *(empty)* | IP of the center server |
| `CENTER_RUNNER_PORT` | `4317` | Port of the center server |
| `CENTER_RUNNER_BASE_URL` | *(auto-built from IP+Port)* | Full base URL of center server |
| `CENTER_RUNNER_COMMAND_SOURCE` | *(auto-built from base URL)* | Poll URL `/api/jobs/next` |
| `CENTER_RUNNER_INTERVAL_MS` | `5000` | Polling interval in ms |
| `CENTER_RUNNER_STATE_FILE` | `jobs/worker-state.json` | Last-run job state file |
| `CENTER_RUNNER_RESULT_FILE` | `jobs/latest-result.json` | Latest result file |

### Adding a new config variable

Adding a variable to `.env` alone has **no effect** — the code must also read it.
Follow these 4 steps every time:

1. **Add to `.env`** with your real value:
   ```
   MY_NEW_VAR=some-value
   ```
2. **Add to `.env.example`** with an empty or safe default so others know the variable exists:
   ```
   MY_NEW_VAR=
   ```
3. **Register in code** — server-side vars go in `src/common/Config.js`, worker-side vars go in `src/worker/WorkerConfig.js`:
   ```js
   // Config.js (server)
   myNewVar: process.env.MY_NEW_VAR || 'default-value',

   // WorkerConfig.js (worker)
   this.myNewVar = process.env.MY_NEW_VAR || 'default-value';
   ```
4. **Use the registered value** inside the relevant class (`Server.js`, `Worker.js`, etc.) via `config.myNewVar` or `this.config.myNewVar`.

> **Rule**: `.env` is the data source. `Config.js` / `WorkerConfig.js` are the single place where every env var is declared and given a default.


Open:

```text
http://localhost:4317/
```

## Run Worker

In another terminal:

```powershell
npm.cmd run worker -- --source http://localhost:4317/api/jobs/next
```

Open more worker terminals to run more jobs in parallel. For example, three
terminals running the same command can claim and run three queued jobs at the
same time.

The worker waits for one queued job from the server, marks the job as `RUNNING`,
executes:

```powershell
node <CENTER_RUNNER_TEST_REPO>\scripts\run-domain-test.mjs <group> <brand> --grep <tag>
```

For queued jobs the worker also passes `--job-id <jobId>` and `JOB_ID=<jobId>`. Then it reports `DONE` or `FAILED` back to the server.

## LAN Control

Run server and workers on the test machine, then open the UI from another LAN
machine by using the test machine IP:

```text
http://<server-lan-ip>:4317/
```

For `cmd.exe`, set variables like this:

```cmd
set CENTER_RUNNER_HOST=0.0.0.0
set CENTER_RUNNER_PORT=4317
set CENTER_RUNNER_TEST_REPO=D:\workspace\TS_PW_FBC
npm.cmd run start
```

## Tailscale Control

Use Tailscale when the browser machine is not on the same LAN as the test
machine.

1. Install Tailscale on the test machine and on every machine that will open the
   Center Runner UI.
2. Sign in to the same Tailscale account or organization on all machines.
3. On the test machine, start Center Runner:

```cmd
cd /d D:\workspace\center_Runner
set CENTER_RUNNER_HOST=0.0.0.0
set CENTER_RUNNER_PORT=4317
set CENTER_RUNNER_TEST_REPO=D:\workspace\TS_PW_FBC
npm.cmd run start
```

4. In one or more other terminals on the same test machine, start workers:

```cmd
cd /d D:\workspace\center_Runner
set CENTER_RUNNER_TEST_REPO=D:\workspace\TS_PW_FBC
npm.cmd run worker -- --source http://localhost:4317/api/jobs/next
```

5. Find the test machine Tailscale IP:

```cmd
tailscale ip -4
```

6. From another Tailscale-connected machine, open:

```text
http://<test-machine-tailscale-ip>:4317/
```

If MagicDNS is enabled in the Tailscale admin console, you can usually use the
machine name instead:

```text
http://<test-machine-name>:4317/
```

Keep `CENTER_RUNNER_HOST=0.0.0.0`; otherwise the server may only listen on
`localhost` and remote Tailscale devices will not reach it.

## Quick Start via Batch Files

Two batch files at the project root handle setup and launch automatically:

```text
start-server.bat
start-workers.bat
```

Start the server (double-click or run from cmd):

```cmd
cd /d D:\workspace\center_Runner
start-server.bat
```

Start workers on the same or another machine:

```cmd
cd /d D:\workspace\center_Runner
start-workers.bat
```

Both scripts install npm dependencies automatically and read config from
`server.env` / `worker.env` at the project root. Copy the matching template
before first run:

```powershell
Copy-Item server.env.example server.env
Copy-Item worker.env.example worker.env
```

Increase `WORKER_COUNT` in `worker.env` to run more queued jobs in parallel.

## Reports

Reports are served from the test repo:

```text
<CENTER_RUNNER_TEST_REPO>\test-results\<brand>\<jobId>\report.html
```

Local runs without `JOB_ID` continue to write to `<CENTER_RUNNER_TEST_REPO>\test-results\<brand>\report.html`.

The web UI embeds the report into the blank report frame when the job finishes.
