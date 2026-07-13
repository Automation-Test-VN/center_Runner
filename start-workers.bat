@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM --- CONFIGURATION ---
set "CENTER_RUNNER_ROOT=D:\workspace\center_Runner"
set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"
set "WORKER_ENV_FILE=D:\workspace\env\worker.env"
set "ALL_DOMAINS_ENV_FILE=%TEST_REPO_ROOT%\test_secret.env"

echo ============================================================
echo STEP 1: CHECK ENVIRONMENT FOR WORKER AND TEST REPO
echo ============================================================
if not exist "%WORKER_ENV_FILE%" goto SKIP_WORKER_MSG
echo [OK] Found worker env file: %WORKER_ENV_FILE%
:SKIP_WORKER_MSG

if not exist "%ALL_DOMAINS_ENV_FILE%" goto SKIP_COPY_TEST_ENV
copy /Y "%ALL_DOMAINS_ENV_FILE%" "%TEST_REPO_ROOT%\.env" >nul
echo [OK] Copied %ALL_DOMAINS_ENV_FILE% to %TEST_REPO_ROOT%\.env
:SKIP_COPY_TEST_ENV

echo.
echo ============================================================
echo STEP 2: PULL LATEST CENTER RUNNER CODE
echo ============================================================
pushd "%CENTER_RUNNER_ROOT%"
if exist ".git\" (
    echo [INFO] Pulling latest Center Runner code...
    call git.exe pull --ff-only
    if errorlevel 1 (
        echo [ERROR] Failed to pull latest Center Runner code.
        popd
        pause
        exit /b 1
    )
) else (
    echo [WARNING] %CENTER_RUNNER_ROOT% is not a git repository. Skipping Center Runner pull.
)
popd

echo.
echo ============================================================
echo STEP 3: NPM INSTALL DEPENDENCIES
echo ============================================================
pushd "%CENTER_RUNNER_ROOT%"
echo [INFO] Installing Center Runner dependencies...
call npm.cmd install
popd

pushd "%TEST_REPO_ROOT%"
echo [INFO] Installing Test Repo dependencies...
call npm.cmd install
popd

echo.
echo ============================================================
echo STEP 4: LOAD CONFIG AND CHECK NETWORK CONNECTION
echo ============================================================
if not exist "%WORKER_ENV_FILE%" goto SKIP_PARSE_ENV
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%WORKER_ENV_FILE%") do (
  if not "%%A" == "" set "%%A=%%B"
)
:SKIP_PARSE_ENV

if "%CENTER_RUNNER_URL%"=="" set "CENTER_RUNNER_URL=http://localhost:4317"
if "%CENTER_RUNNER_COMMAND_SOURCE%"=="" set "CENTER_RUNNER_COMMAND_SOURCE=%CENTER_RUNNER_URL%/api/jobs/next"
if "%WORKER_IP%"=="" set "WORKER_IP=127.0.0.1"
if "%WORKER_NAME%"=="" set "WORKER_NAME=worker-local"
if "%WORKER_COUNT%"=="" set "WORKER_COUNT=3"
if "%CENTER_RUNNER_INTERVAL_MS%"=="" set "CENTER_RUNNER_INTERVAL_MS=5000"

echo [INFO] Checking network connection to Center Server at: %CENTER_RUNNER_URL%

REM Thực hiện lệnh gọi kết nối thực tế
curl -s --connect-timeout 5 "%CENTER_RUNNER_URL%/api/jobs" >nul 2>&1

REM Kiểm tra kết quả bằng lệnh nhảy phẳng, không dùng khối ngoặc ( )
if %ERRORLEVEL% NEQ 0 goto NET_ERROR
echo [SUCCESS] Connection to Center Server is OK!
goto STEP4_START

:NET_ERROR
echo [NETWORK ERROR] Worker CANNOT connect to Center Server!
echo Please check:
echo   1. Is the Center Server running?
echo   2. Is Firewall blocking port 4317 on Center Server?
echo   3. Are both machines on the same network (LAN/VPN)?
pause
exit /b 1

:STEP4_START
echo.
echo ============================================================
echo STEP 5: STARTING WORKERS
echo ============================================================
pushd "%CENTER_RUNNER_ROOT%"
set /a "W_COUNT=%WORKER_COUNT%"
set "I=1"

:LOOP_WORKERS
if %I% GTR %W_COUNT% goto LOOP_END
set "CURRENT_WORKER_NAME=%WORKER_NAME%-%I%"
echo Launching worker %I%/%W_COUNT%: %CURRENT_WORKER_NAME%
start "center-runner-worker-%I%" cmd /k "set WORKER_NAME=%CURRENT_WORKER_NAME%&& node.exe .\worker.mjs --source "%CENTER_RUNNER_COMMAND_SOURCE%" --interval-ms "%CENTER_RUNNER_INTERVAL_MS%""
set /a "I+=3"
goto LOOP_WORKERS

:LOOP_END
popd
echo [SUCCESS] All workers have been launched.
echo.

:wait
timeout /t 3600 /nobreak >nul
goto wait
