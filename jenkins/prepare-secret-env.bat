@echo off
setlocal

if "%TEST_REPO_ROOT%"=="" set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"

if "%ALL_DOMAINS_ENV_FILE%"=="" (
  echo ALL_DOMAINS_ENV_FILE is not set. Use Jenkins Secret file credentials.
  exit /b 1
)

if not exist "%TEST_REPO_ROOT%" (
  echo TEST_REPO_ROOT not found: %TEST_REPO_ROOT%
  exit /b 1
)

copy /Y "%ALL_DOMAINS_ENV_FILE%" "%TEST_REPO_ROOT%\.env" >nul
if errorlevel 1 exit /b 1

echo Secret .env copied to %TEST_REPO_ROOT%\.env
endlocal
