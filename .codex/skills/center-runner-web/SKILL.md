---
name: center-runner-web
description: Build or extend the TS_PW_FBC Center Runner web control panel that collects domain, brand, account credentials, selected Playwright test flows, and writes JSON command files for a runner machine. Use when Codex is asked to create the Center Runner UI, connect it to the existing domain alive check, persist runner commands, expose a local/public web entrypoint, or map UI selections to npm run test domain execution.
---

# Center Runner Web

## Workflow

1. Inspect `scripts/run-domain-test.mjs`, `src/base/BaseSetup.ts`, `playwright.config.ts`, and nearby config before changing runner behavior.
2. Keep the web tool isolated under `tools/center-runner` (or in its dedicated repository) unless the user asks to integrate it into the main framework.
3. Follow the established **OOP** (Object-Oriented Programming) and **POM** (Page Object Model) architectures. Do not add procedural global variables or helper functions.
4. Treat `tool`, `group`, `brand`, and `tag` as the required Alive Daily command fields.
5. Treat `src/common/JobId.js` as the source of truth for job id patterns. `aliveDaily` uses `ALIVE_DAILY_JOB_ID_PATTERN` with format `AL-YYYYMMDD-HHMMSS-brand-XX`; new tools must add a separate registry entry instead of changing the aliveDaily pattern.
6. Do not log passwords in terminal output, browser UI summaries, job ids, or saved preview text. If credentials must be stored for a future manual tool prototype, mark it clearly and keep it local-only.
7. Reuse the repository runner command shape: `npm run test -- <fbc-group> <domain> [playwright args...]`.
8. Preserve one independent spec file per domain. Do not merge domain specs into a cross-domain spec for runner convenience.
9. After TypeScript changes, run `npm run check`. For static HTML/CSS/JS server-only changes, run the local server smoke check instead.

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

## Domain Alive Behavior

- Existing framework behavior is in `BaseSetup.ensureDomainReachable`: it requests `Config.baseUrl` with a 15 second timeout before authentication.
- Web-side alive checks should be a lightweight preflight only. They should not replace Playwright setup validation.
- Prefer `HEAD`, then fallback to `GET` when a site rejects `HEAD`.
- Record status as `IDLE`, `CHECKING`, `QUEUED`, `RUNNING`, `DONE`, or `FAILED`.

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

## Job ID Contract

- Create ids through `createJobIdForTool(tool, { brand, date })`.
- Validate queue and result ids through `isValidJobId()` / `isValidJobFileName()`.
- The worker passes the claimed id to TS_PW_FBC as both `--job-id` and `JOB_ID`.
- TS_PW_FBC writes job-scoped reports to `test-results/<brand>/<jobId>/report.html`.
- When adding a new tool, add a new entry to `JOB_ID_CONFIG_BY_TOOL`; do not reuse or loosen `ALIVE_DAILY_JOB_ID_PATTERN`.

## References

- Read `references/center-runner-patterns.md` when implementing or reviewing the web-to-runner command flow.
