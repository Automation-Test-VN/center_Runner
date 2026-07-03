---
name: center-runner-web
description: Build or extend the TS_PW_FBC Center Runner web control panel that collects domain, brand, account credentials, selected Playwright test flows, and writes JSON command files for a runner machine. Use when Codex is asked to create the Center Runner UI, connect it to the existing domain alive check, persist runner commands, expose a local/public web entrypoint, or map UI selections to npm run test domain execution.
---

# Center Runner Web

## Workflow

1. Inspect `scripts/run-domain-test.mjs`, `src/base/BaseSetup.ts`, `playwright.config.ts`, and nearby config before changing runner behavior.
2. Keep the web tool isolated under `tools/center-runner` unless the user asks to integrate it into the main framework.
3. Persist user requests as JSON commands first; let a separate runner process consume those commands later.
4. Treat `tool`, `group`, `brand`, and `tag` as the required Alive Daily command fields.
5. Do not log passwords in terminal output, browser UI summaries, job ids, or saved preview text. If credentials must be stored for a future manual tool prototype, mark it clearly and keep it local-only.
6. Reuse the repository runner command shape: `npm run test -- <fbc-group> <domain> [playwright args...]`.
7. Preserve one independent spec file per domain. Do not merge domain specs into a cross-domain spec for runner convenience.
8. After TypeScript changes, run `npm run check`. For static HTML/CSS/JS server-only changes, run the local server smoke check instead.

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

## References

- Read `references/center-runner-patterns.md` when implementing or reviewing the web-to-runner command flow.
