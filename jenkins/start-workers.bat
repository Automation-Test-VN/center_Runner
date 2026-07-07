@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM CENTER RUNNER - REMOTE WORKER MACHINE
REM Worker IP : 100.87.225.58
REM Center IP : 100.67.96.22
REM ============================================================

for %%I in ("%~dp0..") do set "DEFAULT_CENTER_RUNNER_ROOT=%%~fI"

if "%CENTER_RUNNER_ROOT%"=="" set "CENTER_RUNNER_ROOT=%DEFAULT_CENTER_RUNNER_ROOT%"

REM Load worker.env (created by Jenkins from the WORKER_ENV credential, or placed
REM manually) so the cmd layer sees the same config node --env-file=worker.env uses.
REM cmd.exe cannot read worker.env by itself, so parse KEY=VALUE lines here.
if exist "%CENTER_RUNNER_ROOT%\worker.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CENTER_RUNNER_ROOT%\worker.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

REM Repo Playwright test on Worker machine
if "%TEST_REPO_ROOT%"=="" set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"
if "%CENTER_RUNNER_TEST_REPO%"=="" set "CENTER_RUNNER_TEST_REPO=%TEST_REPO_ROOT%"

REM IMPORTANT:
REM This BAT runs on Worker machine, so it must call Center IP.
REM Do NOT use localhost here unless Center and Worker are same machine.
if "%CENTER_RUNNER_URL%"=="" set "CENTER_RUNNER_URL=http://100.67.96.22:4317"
if "%CENTER_RUNNER_COMMAND_SOURCE%"=="" set "CENTER_RUNNER_COMMAND_SOURCE=%CENTER_RUNNER_URL%/api/jobs/next"

if "%WORKER_IP%"=="" set "WORKER_IP=100.87.225.58"
if "%WORKER_NAME%"=="" set "WORKER_NAME=worker-100-87-225-58"

if "%WORKER_COUNT%"=="" set "WORKER_COUNT=3"
if "%CENTER_RUNNER_INTERVAL_MS%"=="" set "CENTER_RUNNER_INTERVAL_MS=5000"

echo.
echo ============================================================
echo START CENTER RUNNER REMOTE WORKERS
echo ============================================================
echo CENTER_RUNNER_ROOT      = %CENTER_RUNNER_ROOT%
echo CENTER_RUNNER_TEST_REPO = %CENTER_RUNNER_TEST_REPO%
echo CENTER_RUNNER_URL       = %CENTER_RUNNER_URL%
echo COMMAND_SOURCE          = %CENTER_RUNNER_COMMAND_SOURCE%
echo WORKER_IP               = %WORKER_IP%
echo WORKER_NAME             = %WORKER_NAME%
echo WORKER_COUNT            = %WORKER_COUNT%
echo INTERVAL_MS             = %CENTER_RUNNER_INTERVAL_MS%
echo ============================================================
echo.

if not exist "%CENTER_RUNNER_ROOT%\package.json" (
  echo [ERROR] CENTER_RUNNER_ROOT package.json not found:
  echo %CENTER_RUNNER_ROOT%
  pause
  exit /b 1
)

if not exist "%CENTER_RUNNER_TEST_REPO%\package.json" (
  echo [ERROR] CENTER_RUNNER_TEST_REPO package.json not found:
  echo %CENTER_RUNNER_TEST_REPO%
  pause
  exit /b 1
)

node -v >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js or add node to PATH.
  pause
  exit /b 1
)

npm -v >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js or add npm to PATH.
  pause
  exit /b 1
)

node -e "const n=Number(process.env.WORKER_COUNT || 1); if (!Number.isInteger(n) || n < 1 || n > 20) { console.error('WORKER_COUNT must be an integer from 1 to 20.'); process.exit(1); }"
if errorlevel 1 (
  pause
  exit /b 1
)

echo Checking Center connection...
curl -s "%CENTER_RUNNER_URL%/api/jobs" >nul 2>&1

if errorlevel 1 (
  echo [ERROR] Cannot connect to Center Runner:
  echo %CENTER_RUNNER_URL%
  echo.
  echo Check:
  echo 1. Center server is running
  echo 2. Center firewall opened port 4317
  echo 3. Worker can curl Center IP
  pause
  exit /b 1
)

echo [OK] Center connection success.
echo.

pushd "%CENTER_RUNNER_ROOT%"

for /L %%I in (1,1,%WORKER_COUNT%) do (
  set "CURRENT_WORKER_NAME=%WORKER_NAME%-%%I"

  echo Starting worker %%I/%WORKER_COUNT%: !CURRENT_WORKER_NAME!

  start "center-runner-worker-%%I" /B cmd /c "set WORKER_NAME=!CURRENT_WORKER_NAME!&& npm.cmd run worker -- --source "%CENTER_RUNNER_COMMAND_SOURCE%" --interval-ms "%CENTER_RUNNER_INTERVAL_MS%""
)

popd

echo.
echo [OK] Workers started on %WORKER_IP%.
echo This window must stay open while workers are online.
echo Workers are polling: %CENTER_RUNNER_COMMAND_SOURCE%
echo.

:wait
timeout /t 3600 /nobreak >nul
goto wait
