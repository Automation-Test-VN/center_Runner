@echo off
setlocal

for %%I in ("%~dp0..") do set "DEFAULT_CENTER_RUNNER_ROOT=%%~fI"

if "%CENTER_RUNNER_ROOT%"=="" set "CENTER_RUNNER_ROOT=%DEFAULT_CENTER_RUNNER_ROOT%"

REM Target env file name relative to CENTER_RUNNER_ROOT.
REM Pass "server.env" from the server job and "worker.env" from the worker job.
set "TARGET_ENV=%~1"
if "%TARGET_ENV%"=="" set "TARGET_ENV=.env"

REM CENTER_ENV_FILE is bound by the Jenkins "Secret file" credential
REM (SERVER_ENV for the server job, WORKER_ENV for the worker job).
if "%CENTER_ENV_FILE%"=="" (
  echo CENTER_ENV_FILE is not set. Bind a Jenkins Secret file credential to CENTER_ENV_FILE.
  exit /b 1
)

if not exist "%CENTER_ENV_FILE%" (
  echo CENTER_ENV_FILE not found: %CENTER_ENV_FILE%
  exit /b 1
)

if not exist "%CENTER_RUNNER_ROOT%" (
  echo CENTER_RUNNER_ROOT not found: %CENTER_RUNNER_ROOT%
  exit /b 1
)

copy /Y "%CENTER_ENV_FILE%" "%CENTER_RUNNER_ROOT%\%TARGET_ENV%" >nul
if errorlevel 1 exit /b 1

echo Secret env copied to %CENTER_RUNNER_ROOT%\%TARGET_ENV%
endlocal
