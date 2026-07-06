# Center Runner

Standalone web queue and worker for running TS_PW_FBC domain tests.

## Codebase Layout

* [server.mjs](./server.mjs): Entrypoint for bootstrapping the Server.
* [worker.mjs](./worker.mjs): Entrypoint for starting the Worker daemon.
* [src/](./src/): Core OOP modules split into layers:
  * [common/Config.js](./src/common/Config.js): Configuration and path setup.
  * [common/Job.js](./src/common/Job.js): Job model and serialization.
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
2. **Task Creation**: When the user clicks **Start** on the UI ([app.js](./public/app.js)), a job model is instantiated via [Job.js](./src/common/Job.js) and written as a JSON file to the queue directory by [JobManager.js](./src/server/JobManager.js).
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
* **Files involved**: [app.js](./public/app.js) (`RunnerForm`, `AppController`), [Server.js](./src/server/Server.js) (`POST /api/jobs`), [JobManager.js](./src/server/JobManager.js) (`addJob()`), [Job.js](./src/common/Job.js)
* **Flow**:
  * The user fills out parameters in the browser form and clicks **Start**; `RunnerForm` captures inputs and `AppController` makes a POST request to `/api/jobs`.
  * The server parses this request, instantiates a `Job`, checks for active duplicate jobs, saves the job definition to `jobs/queue/<jobId>.json`, and triggers `WorkerRegistry.notify()` to alert any waiting workers.

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
  * `JobRunner` validates arguments and executes Playwright tests via `spawnSync` using `scripts/run-domain-test.mjs` located in the sibling `TS_PW_FBC` workspace.
  * When execution finishes, `Worker.js` posts results (`DONE` or `FAILED`) back to the server via `POST /api/jobs/complete`.
  * The server's `JobManager.completeJob()` updates the job status JSON, moves it to `jobs/results/`, deletes the temporary queue/running files, and syncs the active job state.

### 5. Report Serving & Displaying
* **Files involved**: [Server.js](./src/server/Server.js) (`GET /reports/*`), [app.js](./public/app.js) (`ReportViewer`, `JobTable`), [Config.js](./src/common/Config.js)
* **Flow**:
  * Playwright saves test results directly to `TS_PW_FBC/test-results/<brand>/report.html`.
  * The server routes any requests under `/reports/*` to serve these HTML assets statically from `Config.testResultsDir`.
  * When a job completes, the UI `JobTable` renders an **Open** button which maps to `ReportViewer.load()`, embedding the static report inside the preview iframe.



## Configure

Set the test repository path when it is not the sibling default `D:\workspace\TS_PW_FBC`:

```powershell
$env:CENTER_RUNNER_TEST_REPO='D:\workspace\TS_PW_FBC'
```

## Run Web

```powershell
npm.cmd run start
```

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

Then it reports `DONE` or `FAILED` back to the server.

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

## Jenkins Worker With Secret .env

Use this when the test repo needs a secret `.env` file for accounts, Google
Sheet credentials, or other private test config.

Helper batch files are available under `jenkins/`:

```text
jenkins\prepare-secret-env.bat
jenkins\install-deps.bat
jenkins\start-server.bat
jenkins\start-workers.bat
```

1. In Jenkins, create a secret file credential:
   - Go to `Manage Jenkins` -> `Credentials`.
   - Add credential with kind `Secret file`.
   - Upload the real `TS_PW_FBC\.env` file.
   - Set ID to `ALL_DOMAINS_ENV_FILE`.

2. Create a Pipeline job that uses this repository.

3. Set Pipeline script path to:

```text
jenkins/center-runner-worker.Jenkinsfile
```

4. Start the Center Runner server on the test machine:

```cmd
cd /d D:\workspace\center_Runner
set CENTER_RUNNER_HOST=0.0.0.0
set CENTER_RUNNER_PORT=4317
set CENTER_RUNNER_TEST_REPO=D:\workspace\TS_PW_FBC
npm.cmd run start
```

5. Run the Jenkins worker job with these defaults:

```text
CENTER_RUNNER_ROOT=D:\workspace\center_Runner
TEST_REPO_ROOT=D:\workspace\TS_PW_FBC
CENTER_RUNNER_URL=http://localhost:4317
WORKER_COUNT=1
ENV_CREDENTIALS_ID=ALL_DOMAINS_ENV_FILE
```

The pipeline calls:

```cmd
jenkins\prepare-secret-env.bat
jenkins\install-deps.bat
jenkins\start-workers.bat
```

Increase `WORKER_COUNT` to run more queued jobs in parallel. The Jenkins build
is intentionally long-running; keep it running while you want workers online,
and stop the build when you want to stop workers.

The pipeline copies the Jenkins secret file to:

```text
D:\workspace\TS_PW_FBC\.env
```

Do not print this file in logs and do not commit it to git.

You can also run the same batch files manually from `cmd.exe`.

Start the server:

```cmd
cd /d D:\workspace\center_Runner
set CENTER_RUNNER_HOST=0.0.0.0
set CENTER_RUNNER_PORT=4317
set TEST_REPO_ROOT=D:\workspace\TS_PW_FBC
jenkins\start-server.bat
```

Start workers:

```cmd
cd /d D:\workspace\center_Runner
set TEST_REPO_ROOT=D:\workspace\TS_PW_FBC
set CENTER_RUNNER_URL=http://localhost:4317
set WORKER_COUNT=3
jenkins\start-workers.bat
```

## Reports

Reports are served from the test repo:

```text
<CENTER_RUNNER_TEST_REPO>\test-results\<brand>\report.html
```

The web UI embeds the report into the blank report frame when the job finishes.
