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
