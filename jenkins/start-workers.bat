@echo off
setlocal EnableExtensions

for %%I in ("%~dp0..") do set "DEFAULT_CENTER_RUNNER_ROOT=%%~fI"

if "%CENTER_RUNNER_ROOT%"=="" set "CENTER_RUNNER_ROOT=%DEFAULT_CENTER_RUNNER_ROOT%"
if "%TEST_REPO_ROOT%"=="" set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"
if "%CENTER_RUNNER_TEST_REPO%"=="" set "CENTER_RUNNER_TEST_REPO=%TEST_REPO_ROOT%"
if "%CENTER_RUNNER_URL%"=="" set "CENTER_RUNNER_URL=http://localhost:4317"
if "%CENTER_RUNNER_COMMAND_SOURCE%"=="" set "CENTER_RUNNER_COMMAND_SOURCE=%CENTER_RUNNER_URL%/api/jobs/next"
if "%WORKER_COUNT%"=="" set "WORKER_COUNT=3"

if not exist "%CENTER_RUNNER_ROOT%\package.json" (
  echo CENTER_RUNNER_ROOT package.json not found: %CENTER_RUNNER_ROOT%
  exit /b 1
)

if not exist "%CENTER_RUNNER_TEST_REPO%\package.json" (
  echo CENTER_RUNNER_TEST_REPO package.json not found: %CENTER_RUNNER_TEST_REPO%
  exit /b 1
)

node -e "const n=Number(process.env.WORKER_COUNT || 1); if (!Number.isInteger(n) || n < 1 || n > 20) { console.error('WORKER_COUNT must be an integer from 1 to 20.'); process.exit(1); }"
if errorlevel 1 exit /b 1

pushd "%CENTER_RUNNER_ROOT%"

for /L %%I in (1,1,%WORKER_COUNT%) do (
  echo Starting Center Runner worker %%I of %WORKER_COUNT% from %CENTER_RUNNER_COMMAND_SOURCE%
  start "center-runner-worker-%%I" /B npm.cmd run worker -- --source "%CENTER_RUNNER_COMMAND_SOURCE%"
)

popd

echo Workers started. Keep this process running while you want workers online.

:wait
timeout /t 3600 /nobreak >nul
goto wait
