@echo off
setlocal

for %%I in ("%~dp0..") do set "DEFAULT_CENTER_RUNNER_ROOT=%%~fI"

if "%CENTER_RUNNER_ROOT%"=="" set "CENTER_RUNNER_ROOT=%DEFAULT_CENTER_RUNNER_ROOT%"
if "%TEST_REPO_ROOT%"=="" set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"

if not exist "%CENTER_RUNNER_ROOT%\package.json" (
  echo CENTER_RUNNER_ROOT package.json not found: %CENTER_RUNNER_ROOT%
  exit /b 1
)

if not exist "%TEST_REPO_ROOT%\package.json" (
  echo TEST_REPO_ROOT package.json not found: %TEST_REPO_ROOT%
  exit /b 1
)

pushd "%CENTER_RUNNER_ROOT%"
call npm.cmd install
if errorlevel 1 exit /b 1
popd

pushd "%TEST_REPO_ROOT%"
call npm.cmd install
if errorlevel 1 exit /b 1
popd

endlocal
