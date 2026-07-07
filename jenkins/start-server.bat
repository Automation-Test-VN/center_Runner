@echo off
setlocal

for %%I in ("%~dp0..") do set "DEFAULT_CENTER_RUNNER_ROOT=%%~fI"

if "%CENTER_RUNNER_ROOT%"=="" set "CENTER_RUNNER_ROOT=%DEFAULT_CENTER_RUNNER_ROOT%"

REM Load server.env (created by Jenkins from the SERVER_ENV credential, or placed
REM manually) so the cmd layer sees the same config node --env-file=server.env uses.
if exist "%CENTER_RUNNER_ROOT%\server.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CENTER_RUNNER_ROOT%\server.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if "%CENTER_RUNNER_HOST%"=="" set "CENTER_RUNNER_HOST=0.0.0.0"
if "%CENTER_RUNNER_PORT%"=="" set "CENTER_RUNNER_PORT=4317"
if "%CENTER_RUNNER_TEST_REPO%"=="" (
  if not "%TEST_REPO_ROOT%"=="" (
    set "CENTER_RUNNER_TEST_REPO=%TEST_REPO_ROOT%"
  ) else (
    set "CENTER_RUNNER_TEST_REPO=D:\workspace\TS_PW_FBC"
  )
)

if not exist "%CENTER_RUNNER_ROOT%\package.json" (
  echo CENTER_RUNNER_ROOT package.json not found: %CENTER_RUNNER_ROOT%
  exit /b 1
)

echo Starting Center Runner server on %CENTER_RUNNER_HOST%:%CENTER_RUNNER_PORT%
echo CENTER_RUNNER_TEST_REPO=%CENTER_RUNNER_TEST_REPO%

pushd "%CENTER_RUNNER_ROOT%"
call npm.cmd run start
set "EXIT_CODE=%ERRORLEVEL%"
popd

exit /b %EXIT_CODE%
