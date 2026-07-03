# Center Runner

Standalone web queue and worker for running TS_PW_FBC domain tests.

## Layout

- `server.mjs`: web server, job API, report static server.
- `worker.mjs`: worker process that waits for jobs and executes the test repo runner.
- `public/`: Center Runner UI.
- `.codex/skills/center-runner-web/`: AI skill/instructions for this tool.

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

The worker waits for jobs from the server, marks the job as `RUNNING`, executes:

```powershell
node <CENTER_RUNNER_TEST_REPO>\scripts\run-domain-test.mjs <group> <brand> --grep <tag>
```

Then it reports `DONE` or `FAILED` back to the server.

## Reports

Reports are served from the test repo:

```text
<CENTER_RUNNER_TEST_REPO>\test-results\<brand>\report.html
```

The web UI embeds the report into the blank report frame when the job finishes.
