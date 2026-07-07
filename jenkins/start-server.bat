@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM CAU HINH DUONG DAN MAC DINH CHO SERVER
REM ============================================================
set "CENTER_RUNNER_ROOT=D:\workspace\center_Runner"
set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"
set "LOCAL_CREDENTIALS_DIR=D:\workspace\credentials_config"
set "SERVER_ENV_FILE=%LOCAL_CREDENTIALS_DIR%\server_secret.env"

echo ============================================================
echo BUOC 1: CHUAN BI MOI TRUONG CHO SERVER
echo ============================================================
if exist "%SERVER_ENV_FILE%" (
    copy /Y "%SERVER_ENV_FILE%" "%CENTER_RUNNER_ROOT%\server.env" >nul
    echo [Thanh cong] Da sao chep %SERVER_ENV_FILE% sang %CENTER_RUNNER_ROOT%\server.env
) else (
    echo [Canh bao] Khong tim thay file %SERVER_ENV_FILE%. Dung cau hinh mac dinh.
)

echo.
echo ============================================================
echo BUOC 2: CAI DAT THU VIEN (NPM INSTALL)
echo ============================================================
pushd "%CENTER_RUNNER_ROOT%"
echo [Info] Dang tien hanh cai dat thu vien cho Center Runner...
call npm.cmd install
popd

pushd "%TEST_REPO_ROOT%"
echo [Info] Dang tien hanh cai dat thu vien cho Test Repo...
call npm.cmd install
popd

echo.
echo ============================================================
echo BUOC 3: KHOI DONG SERVER
echo ============================================================
REM Doc file server.env de nap bien moi truong
if exist "%CENTER_RUNNER_ROOT%\server.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CENTER_RUNNER_ROOT%\server.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

REM Gan gia tri mac dinh neu chua dinh nghia trong file .env [cite: 7]
if "%CENTER_RUNNER_HOST%"=="" set "CENTER_RUNNER_HOST=0.0.0.0" [cite: 7]
if "%CENTER_RUNNER_PORT%"=="" set "CENTER_RUNNER_PORT=4317" [cite: 7]
if "%CENTER_RUNNER_TEST_REPO%"=="" set "CENTER_RUNNER_TEST_REPO=%TEST_REPO_ROOT%"

echo [Info] Dang khoi dong Center Runner server tren %CENTER_RUNNER_HOST%:%CENTER_RUNNER_PORT% [cite: 8]
echo [Info] CENTER_RUNNER_TEST_REPO=%CENTER_RUNNER_TEST_REPO% [cite: 8]

pushd "%CENTER_RUNNER_ROOT%" [cite: 8]
call npm.cmd run start [cite: 8]
set "EXIT_CODE=%ERRORLEVEL%" [cite: 8]
popd [cite: 8]

pause
exit /b %EXIT_CODE% [cite: 8]