---
trigger: always
---

# Center Runner Engineering Rules

## Scope And Boundaries

- Treat `center_Runner` as a standalone Node.js HTTP queue, worker daemon, static browser UI, and Windows startup project.
- Do not modify `../TS_PW_FBC` unless the requested behavior crosses the runner/test contract.
- Keep environment files and secrets outside the repository. Operational batch files load `D:\workspace\env\server.env` and `D:\workspace\env\worker.env`.
- Preserve unrelated worktree changes and generated job/report artifacts.

## Live Execution Paths

- Server: `server.mjs` -> `src/server/Server.js` -> `src/server/JobManager.js`.
- Worker: `worker.mjs` -> `src/worker/Worker.js`.
- Browser: `public/index.html`, `public/app.js`, and `public/styles.css` served directly by the server.
- Startup: `start-server.bat` and `start-workers.bat` are the operational Windows entrypoints.
- Confirm a class is imported by the live path before treating it as runtime truth. `JobFetcher.js` and `JobRunner.js` currently duplicate parts of logic inlined in `Worker.js`.

## Job Lifecycle And Filesystem Safety

- Preserve the state machine `QUEUED -> RUNNING -> DONE|FAILED|ABORTED`.
- Claim jobs with atomic `fs.rename`; never replace this with read-then-write.
- Write job JSON through a temporary file followed by rename to avoid torn reads.
- Keep job-id and filename validation centralized in `src/common/JobId.js`.
- Do not silently recover a stale result or report from another job identity.
- Keep active job cleanup, latest-state synchronization, and per-worker state updates consistent on every terminal path.

## Worker Process And Repository Lock

- Acquire the shared test-repository lock before `git pull --ff-only` and hold it until the child process finishes or fails to start.
- Release file handles, lock files, polling intervals, and child-process resources on every success, failure, abort, and synchronous spawn exception.
- A failed pre-run pull must fail the job instead of running stale code.
- On Windows, do not spawn `.cmd` files directly with `shell: false`; use a validated `cmd.exe` command or an executable Node entrypoint.
- Never execute arbitrary command text received from the browser or server. Build arguments only from validated tool fields.
- When spawn or reporting fails, preserve the original error while still attempting local result/state cleanup.

## Tool, Job ID, And Report Contract

- `aliveDaily`: `AL-YYYYMMDD-HHMMSS-brand-XX`, report namespace `<brand>`.
- `checkAccess`: `CA-YYYYMMDD-HHMMSS-XX`, report namespace `checkAccess`.
- Extend `JOB_ID_CONFIG_BY_TOOL` for new tools; do not loosen existing patterns.
- Validate command shapes consistently in server creation and worker execution paths.
- Pass queued job identity to `TS_PW_FBC` as `JOB_ID`; aliveDaily also passes `--job-id` through its runner.
- Store and serve job-scoped reports as `/reports/<namespace>/<jobId>/report.html`.
- Update server storage, worker lookup/upload, UI result data, `README.md`, `CLAUDE.md`, relevant skills, and sibling contract references together when this contract changes.

## Server And API

- Keep request methods and status codes explicit in `Server.js`.
- Bound untrusted input and reject invalid job ids, command fields, paths, and unsupported tools before filesystem access.
- Preserve report/static path containment beneath configured roots.
- Avoid blocking work in the HTTP request loop; child test execution belongs on workers.
- Long-poll timeouts and disconnects are expected states, not job failures.

## Browser UI

- Keep `public/app.js` class-based: `RunnerForm`, `JobTable`, `JobSummary`, `ReportViewer`, and `AppController`.
- Keep UI-only pagination and rendering logic client-side when the API already returns the needed data.
- Render the report **Open** button only for terminal jobs with a valid `reportUrl`.
- Do not expose secrets, environment values, or arbitrary HTML from job input.

## Configuration And Startup

- Server configuration belongs in `src/common/Config.js`; worker configuration belongs in `src/worker/WorkerConfig.js`.
- Trace the full `batch -> node/npm -> CLI args -> env` chain before changing startup behavior.
- Keep Center Runner self-update separate from the worker's update of `TS_PW_FBC`.
- Preserve `git pull --ff-only` semantics unless the user explicitly authorizes another checkout policy.
- Background helpers such as Tailscale must not block server startup.

## Verification

- Run `node --check` for every changed `.js` or `.mjs` file.
- Run `git diff --check` and inspect the final diff for unrelated changes.
- For worker changes, verify command construction plus success, nonzero exit, synchronous spawn error, lock release, and completion reporting as applicable.
- For queue/server changes, verify state transitions and file movement without using production job files.
- For static UI changes, run `node --check public/app.js` and verify the served HTML/API behavior through a temporary server when practical.
- For cross-repo changes, verify the actual Center Runner -> TS_PW_FBC runtime contract, not only isolated syntax checks.
