# Center Runner Patterns

## Phased Build

1. Domain panel: collect URL, brand group, account, show status, save a command JSON.
2. Test selection panel: map rows to stable ids and groups.
3. Runner queue: watch JSON command files and execute one job at a time.
4. Results sync: write status and report links back to JSON.
5. Public access: add authentication, TLS, and network exposure only after local behavior is stable.

## UI Rules

- Keep the first screen as the working control panel, not a landing page.
- Use dense, scan-friendly controls similar to the current spreadsheet-like runner.
- Keep the Domain panel above the test table.
- Use stable row ids such as `register`, `login`, `deposit-bank`, and `withdraw-bank`.
- Include select all, clear selection, and core flow controls.
- Keep status visible beside Job ID and Brand.

## Runner Rules

- The web server may create JSON command files.
- A separate runner should claim a queued job, update status to `RUNNING`, execute Playwright, then write `DONE` or `FAILED`.
- The runner should validate `group` with `/^fbc\d+$/`, `brand` with `/^[a-z0-9-]+$/`, and `tag` with `/^@[A-Za-z0-9_-]+$/` before spawning tests.
- Job id patterns are per tool and live in `src/common/JobId.js`: aliveDaily uses `AL-YYYYMMDD-HHMMSS-brand-XX`; checkAccess uses `CA-YYYYMMDD-HHMMSS-XX`.
- Create ids with `createJobIdForTool(tool, { brand, date })`; add new tools by extending `JOB_ID_CONFIG_BY_TOOL` with a new pattern, format label, and generator.
- For queued runs, pass the claimed id through `JOB_ID`; aliveDaily also forwards `--job-id <jobId>` to its domain runner.
- Keep reports job-scoped: `test-results/<brand>/<jobId>/report.html` for aliveDaily and `test-results/checkAccess/<jobId>/report.html` for checkAccess.
- Never execute arbitrary shell text from the browser. Build command arguments from validated fields.
- Avoid overlapping writes to the same command file; write to a temp file and rename for future queue implementations.
