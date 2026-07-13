---
trigger: always
---

# Center Runner Skill Routing

## Routing Rules

- Browser control panel, form fields, job table, report viewer, static HTML/CSS/JS, or web-to-runner command mapping:
  - Read `.codex/skills/center-runner-web/SKILL.md`.
  - Read only the referenced material relevant to the task.
- Center Runner `JOB_ID`, worker-to-TS_PW_FBC execution, report output/upload paths, or cross-repository tool contracts:
  - Read `.agents/rules/center_runner_rules.md`.
  - Treat `src/common/JobId.js` as the Center Runner source of truth.
  - Read `../TS_PW_FBC/.codex/skills/center-runner-job-id/SKILL.md` and its required contract reference when changing the sibling side.
- Server/worker startup, external env files, repository pulls, Tailscale, or batch scripts:
  - Use `.agents/rules/center_runner_rules.md` and inspect both `start-server.bat` and `start-workers.bat` before editing.
- Queue races, stale jobs, abort behavior, lock files, spawn failures, or missing completion callbacks:
  - Trace `Server.js -> JobManager.js -> Worker.js` end to end before proposing a fix.

## Ambiguous Requests

- Determine whether the failure occurs before claim, during repository preparation, during child-process startup, inside TS_PW_FBC, during report upload, or during server/UI rendering.
- Ask for user input only when a missing business decision materially changes the result; otherwise make the smallest evidence-backed assumption.
- Keep changes in one repository when the contract does not require a sibling update.

## Always Verify

- Preserve dirty-worktree changes.
- Validate real runtime behavior in addition to static checks.
- Keep secrets and external env files outside the repository.
- Mirror shared contract changes across code, README/CLAUDE/AGENTS, rules, skills, and references.
