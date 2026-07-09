@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM --- CONFIGURATION ---
set "CENTER_RUNNER_ROOT=D:\workspace\center_Runner"
set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"
set "SERVER_ENV_FILE=D:\workspace\env\server.env"

echo ============================================================
echo STEP 1: CHECK ENVIRONMENT FOR SERVER
echo ============================================================
if exist "%SERVER_ENV_FILE%" (
    echo [OK] Found server env file: %SERVER_ENV_FILE%
) else (
    echo [WARNING] server env file not found at %SERVER_ENV_FILE%. Using default configurations.
)

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
echo STEP 4: STARTING SERVER
echo ============================================================
if exist "%SERVER_ENV_FILE%" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%SERVER_ENV_FILE%") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if "%CENTER_RUNNER_HOST%"=="" set "CENTER_RUNNER_HOST=0.0.0.0"
if "%CENTER_RUNNER_PORT%"=="" set "CENTER_RUNNER_PORT=4317"
if "%CENTER_RUNNER_TEST_REPO%"=="" set "CENTER_RUNNER_TEST_REPO=%TEST_REPO_ROOT%"

echo [INFO] Starting Center Runner server on %CENTER_RUNNER_HOST%:%CENTER_RUNNER_PORT%
echo [INFO] CENTER_RUNNER_TEST_REPO=%CENTER_RUNNER_TEST_REPO%

pushd "%CENTER_RUNNER_ROOT%"
call node.exe .\server.mjs
set "EXIT_CODE=%ERRORLEVEL%"
popd

pause
exit /b %EXIT_CODE%
