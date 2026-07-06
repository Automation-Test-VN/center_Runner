@echo off
setlocal EnableExtensions

REM ============================================================
REM CENTER RUNNER - WORKER MACHINE
REM Worker IP : 100.87.225.58
REM Center IP : 100.67.96.22
REM ============================================================

for %%I in ("%~dp0..") do set "DEFAULT_CENTER_RUNNER_ROOT=%%~fI"

if "%CENTER_RUNNER_ROOT%"=="" set "CENTER_RUNNER_ROOT=%DEFAULT_CENTER_RUNNER_ROOT%"

REM Repo test trên máy Worker
if "%TEST_REPO_ROOT%"=="" set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"
if "%CENTER_RUNNER_TEST_REPO%"=="" set "CENTER_RUNNER_TEST_REPO=%TEST_REPO_ROOT%"

REM Worker phải gọi về IP Center, không dùng localhost
if "%CENTER_RUNNER_URL%"=="" set "CENTER_RUNNER_URL=http://100.67.96.22:4317"
if "%CENTER_RUNNER_COMMAND_SOURCE%"=="" set "CENTER_RUNNER_COMMAND_SOURCE=%CENTER_RUNNER_URL%/api/jobs/next"

REM Thông tin Worker
if "%WORKER_IP%"=="" set "WORKER_IP=100.87.225.58"
if "%WORKER_NAME%"=="" set "WORKER_NAME=worker-100-87-225-58"

REM Số worker chạy song song trên máy này
if "%WORKER_COUNT%"=="" set "WORKER_COUNT=3"

if "%CENTER_RUNNER_INTERVAL_MS%"=="" set "CENTER_RUNNER_INTERVAL_MS=5000"

echo.
echo ============================================================
echo START CENTER RUNNER WORKER
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
  echo [ERROR] Node.js not found.
  pause
  exit /b 1
)

npm -v >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found.
  pause
  exit /b 1
)

echo Checking Center connection...
curl -s "%CENTER_RUNNER_URL%/api/jobs" >nul 2>&1

if errorlevel 1 (
  echo [ERROR] Cannot connect to Center Runner:
  echo %CENTER_RUNNER_URL%
  echo.
  echo Check Center server, firewall port 4317, or network connection.
  pause
  exit /b 1
)

echo [OK] Center connection success.
echo.

pushd "%CENTER_RUNNER_ROOT%"

for /L %%I in (1,1,%WORKER_COUNT%) do (
  echo Starting worker %%I/%WORKER_COUNT% ...

  start "center-runner-worker-%%I" /B npm.cmd run worker -- ^
    --source "%CENTER_RUNNER_COMMAND_SOURCE%" ^
    --interval-ms "%CENTER_RUNNER_INTERVAL_MS%"
)

popd

echo.
echo [OK] Workers started on %WORKER_IP%.
echo This window must stay open while workers are online.
echo.

:wait
timeout /t 3600 /nobreak >nul
goto wait