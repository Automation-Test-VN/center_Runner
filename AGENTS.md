# Center Runner Agent Workflow

## Trigger

Use this workflow only when the user explicitly asks for the project flow, agent workflow, multiple agents, or task delegation.

Examples:

- `Use the Center Runner project flow.`
- `Use the senior planner for this task.`
- `Divide this task among agents.`

Ordinary requests are handled directly by the main agent without spawning subagents.

## Roles

### Main Agent - Orchestrator

- Own scope, approvals, user communication, and the final completion decision.
- Preserve unrelated worktree changes and keep repository boundaries explicit.
- Trace cross-repository contracts through both `center_Runner` and `../TS_PW_FBC` when required.
- Never allow parallel write agents to edit overlapping files.

### `senior-research-planner` - Research And Planning

- Work read-only.
- Trace the live server, queue, worker, child-process, result, and report paths end to end.
- Produce an implementation-ready plan with evidence, risks, acceptance criteria, and verification commands.

Configuration: `.codex/agents/senior-research-planner.toml`.

### `center-runner-implementer` - Implementation

- Implement the approved scope with workspace write access.
- Preserve queue atomicity, worker cleanup, job-id/report contracts, and Windows runtime behavior.
- Verify the narrowest relevant runtime surface in addition to syntax checks.

Configuration: `.codex/agents/center-runner-implementer.toml`.

### `senior-technical-debt-reviewer` - Review

- Work read-only after implementation.
- Review the final diff and affected runtime flow for regressions, races, stale state, missing cleanup, and test gaps.
- Return findings ordered by severity with exact file and line references.

Configuration: `.codex/agents/senior-technical-debt-reviewer.toml`.

## Standard Flow

### 1. Intake

The main agent must:

1. Confirm the requested outcome and whether the scope is server, worker, browser UI, startup scripts, sibling test repo, or a cross-repo contract.
2. Read `.agents/rules/center_runner_rules.md` and `.agents/rules/skill_routing.md`.
3. Inspect `git status --short` and preserve unrelated changes.
4. Identify external writes, network actions, process restarts, destructive job cleanup, or business decisions requiring approval.
5. Start `senior-research-planner` only when the user explicitly requested this workflow.

### 2. Research Handoff

The planner must return:

- verified live execution paths rather than assumptions based on unused helper classes;
- affected files, callers, APIs, state files, and sibling-repo touchpoints;
- an ordered implementation plan and rollback considerations;
- focused acceptance checks for success and failure behavior;
- unresolved decisions that materially affect the result.

### 3. Implementation Handoff

Start `center-runner-implementer` with the original request, research evidence, confirmed scope, dirty-worktree files, acceptance criteria, and required verification.

### 4. Review Handoff

Start `senior-technical-debt-reviewer` with the original request, plan, implementation summary, final diff, and test results. Review only the requested change and its direct regression surface.

### 5. Remediation

- Fix confirmed P0/P1 issues that are in scope.
- Fix P2 issues directly caused by the change when reasonably bounded.
- Report pre-existing or out-of-scope debt separately.
- Perform at most one focused re-review unless a remaining material defect justifies another pass.

### 6. Completion

The main agent independently confirms the requested behavior, relevant checks, final diff, repository boundary, and any required server/worker restart. The final answer reports changed files, verification, and remaining risks without exposing raw subagent logs.

## Fast Paths

- Research-only request: use only `senior-research-planner`.
- Approved implementation plan: use `center-runner-implementer`, then review.
- Review-only request: use only `senior-technical-debt-reviewer` and do not edit.
- Trivial change: handle directly unless the user explicitly requested the full workflow.

## Repository Requirements

All agents must respect:

- `.agents/rules/center_runner_rules.md`;
- `.agents/rules/skill_routing.md`;
- `src/common/JobId.js` as the source of truth for tool-specific job ids and report namespaces;
- atomic queue claims through `fs.rename` and atomic JSON writes through temp-file rename;
- repository locks and guaranteed cleanup around worker child-process execution;
- external environment files under `D:\workspace\env` for operational batch startup;
- no secrets or credentials in source, logs, job JSON, report URLs, or UI summaries;
- `node --check` for changed JavaScript entrypoints and focused runtime verification proportional to risk.

## Live Architecture Notes

- Server entrypoint: `server.mjs` -> `src/server/Server.js` -> `src/server/JobManager.js`.
- Worker entrypoint: `worker.mjs` -> `src/worker/Worker.js`.
- `Worker.js` currently owns the live fetch, validation, spawn, lock, result, and report-upload flow.
- `src/worker/JobFetcher.js` and `src/worker/JobRunner.js` are not the live worker orchestration path; keep them aligned when their duplicated contracts change, but do not assume editing them changes runtime behavior.
- Center Runner may launch `../TS_PW_FBC`; cross-repo changes require tracing both sides and updating shared documentation intentionally.
