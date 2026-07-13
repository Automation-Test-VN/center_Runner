---
name: center-runner-web
description: Build or extend the Center Runner browser control panel and its web-to-queue integration. Use for form fields, job tables, status summaries, report viewing, static HTML/CSS/JS, domain preflight controls, or mapping aliveDaily and checkAccess UI selections to validated server commands.
---

# Center Runner Web

## Workflow

1. Read `.agents/rules/center_runner_rules.md` and inspect `public/app.js`, `src/server/Server.js`, `src/server/JobManager.js`, `src/common/JobId.js`, and the live `src/worker/Worker.js` path relevant to the change.
2. Keep changes inside `center_Runner` unless a verified contract change also requires `../TS_PW_FBC`.
3. Follow the established **OOP** (Object-Oriented Programming) and **POM** (Page Object Model) architectures. Do not add procedural global variables or helper functions.
4. Use `{ tool, group, brand, tag }` for aliveDaily and `{ tool, tag }` for checkAccess.
5. Treat `src/common/JobId.js` as the source of truth. AliveDaily uses `AL-YYYYMMDD-HHMMSS-brand-XX`; checkAccess uses `CA-YYYYMMDD-HHMMSS-XX`.
6. Do not log passwords in terminal output, browser UI summaries, job ids, or saved preview text. If credentials must be stored for a future manual tool prototype, mark it clearly and keep it local-only.
7. Never accept arbitrary shell commands from the browser. Build tool-specific worker commands from validated fields.
8. Preserve independent TS_PW_FBC domain specs when a cross-repo task reaches the sibling test repository.
9. Run `node --check public/app.js` for UI JavaScript changes and verify the served HTML/API behavior through a temporary server when practical.

## Codebase Architecture (OOP & POM Standards)

All new features and modifications must adhere to the following class structure:

### Common Layer
* `Config`: Encapsulates environments, directories, port, host, and path resolutions.
* `Job`: Represents the Job domain model, validation, and JSON serialization state.
* `JobId`: Owns tool-specific job id patterns, id generators, validators, and report URL helpers.

### Server Layer (`src/server/`)
* `JobManager`: Core manager handling reading, writing, claiming, and completing jobs on the filesystem.
* `DomainChecker`: Lightweight HTTP HEAD/GET request domain preflight reachability helper.
* `WorkerRegistry`: Manages worker long-polling queues, timeouts, and callbacks.
* `Server`: Integrates routing, serving static files, APIs, and HTTP server lifecycle.

### Worker Layer (`src/worker/`)
* `WorkerConfig`: Parses CLI arguments and config overrides.
* `JobFetcher`: Retrieves jobs from URLs or JSON files.
* `JobRunner`: Validates commands and spawns Playwright test executions.
* `Worker`: Orchestrates the worker's polling loop, state updates, and result submissions.

### Frontend Page Object Model (`public/app.js`)
The UI is divided into page/view component classes:
* `RunnerForm`: Controls inputs, options syncing, and submit validation.
* `JobTable`: Renders dynamic rows of recent and running tests.
* `JobSummary`: Updates the control panel header indicators.
* `ReportViewer`: Embeds and clears Playwright HTML reports.
* `AppController`: Coordinates interactions, fetching configurations, and API polling.

## Supported Tool Behavior

- Existing framework behavior is in `BaseSetup.ensureDomainReachable`: it requests `Config.baseUrl` with a 15 second timeout before authentication.
- Web-side alive checks should be a lightweight preflight only. They should not replace Playwright setup validation.
- Prefer `HEAD`, then fallback to `GET` when a site rejects `HEAD`.
- Record status as `IDLE`, `CHECKING`, `QUEUED`, `RUNNING`, `DONE`, or `FAILED`.
- CheckAccess has no group or brand fields and uses the fixed `@checkAccess` tag.
- Report buttons depend on a terminal job containing a valid job-specific `reportUrl`.

## JSON Command Shape

Use this shape unless a later migration requires a version bump:

```json
{
  "tool": "aliveDaily",
  "group": "fbc1",
  "brand": "mayman",
  "tag": "@smoke"
}
```

CheckAccess uses:

```json
{
  "tool": "checkAccess",
  "tag": "@checkAccess"
}
```

## Job ID Contract

- Create ids through `createJobIdForTool(tool, { brand, date })`.
- Validate queue and result ids through `isValidJobId()` / `isValidJobFileName()`.
- The worker passes every claimed id through `JOB_ID`; aliveDaily also forwards `--job-id` to the domain runner.
- AliveDaily uses `AL-YYYYMMDD-HHMMSS-brand-XX`; checkAccess uses `CA-YYYYMMDD-HHMMSS-XX`.
- TS_PW_FBC writes aliveDaily reports to `test-results/<brand>/<jobId>/report.html` and checkAccess reports to `test-results/checkAccess/<jobId>/report.html`.
- The worker uploads HTML under the same namespace so the server can expose `/reports/<namespace>/<jobId>/report.html`.
- When adding a new tool, add a new entry to `JOB_ID_CONFIG_BY_TOOL`; do not reuse or loosen `ALIVE_DAILY_JOB_ID_PATTERN`.

## References

- Read `references/center-runner-patterns.md` when implementing or reviewing the web-to-runner command flow.
