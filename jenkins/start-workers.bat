@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM CẤU HÌNH ĐƯỜNG DẪN MẶC ĐỊNH CHO WORKER
REM ============================================================
set "CENTER_RUNNER_ROOT=D:\workspace\center_Runner"
set "TEST_REPO_ROOT=D:\workspace\TS_PW_FBC"
set "LOCAL_CREDENTIALS_DIR=D:\workspace\credentials_config"
set "WORKER_ENV_FILE=%LOCAL_CREDENTIALS_DIR%\worker_secret.env"
set "ALL_DOMAINS_ENV_FILE=%LOCAL_CREDENTIALS_DIR%\test_secret.env"

echo ============================================================
echo STEP 1: CHUẨN BỊ MÔI TRƯỜNG CHO WORKER VÀ TEST REPO
echo ============================================================
if exist "%WORKER_ENV_FILE%" (
    copy /Y "%WORKER_ENV_FILE%" "%CENTER_RUNNER_ROOT%\worker.env" >nul
    echo [OK] Da copy %WORKER_ENV_FILE% sang %CENTER_RUNNER_ROOT%\worker.env
)

if exist "%ALL_DOMAINS_ENV_FILE%" (
    copy /Y "%ALL_DOMAINS_ENV_FILE%" "%TEST_REPO_ROOT%\.env" >nul
    echo [OK] Da copy %ALL_DOMAINS_ENV_FILE% sang %TEST_REPO_ROOT%\.env
)

echo.
echo ============================================================
echo STEP 2: CÀI ĐẶT DEPENDENCIES (NPM INSTALL)
echo ============================================================
pushd "%CENTER_RUNNER_ROOT%"
echo [INFO] Dang cai dat thu vien cho Center Runner...
call npm.cmd install
popd

pushd "%TEST_REPO_ROOT%"
echo [INFO] Dang cai dat thu vien cho Test Repo...
call npm.cmd install
popd

echo.
echo ============================================================
echo STEP 3: NẠP CẤU HÌNH VÀ KIỂM TRA MẠNG
echo ============================================================
if exist "%CENTER_RUNNER_ROOT%\worker.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%CENTER_RUNNER_ROOT%\worker.env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

if "%CENTER_RUNNER_URL%"=="" set "CENTER_RUNNER_URL=http://localhost:4317"
if "%CENTER_RUNNER_COMMAND_SOURCE%"=="" set "CENTER_RUNNER_COMMAND_SOURCE=%CENTER_RUNNER_URL%/api/jobs/next"
if "%WORKER_IP%"=="" set "WORKER_IP=127.0.0.1"
if "%WORKER_NAME%"=="" set "WORKER_NAME=worker-%WORKER_IP:.=-%"
if "%WORKER_COUNT%"=="" set "WORKER_COUNT=3"
if "%CENTER_RUNNER_INTERVAL_MS%"=="" set "CENTER_RUNNER_INTERVAL_MS=5000"

echo [INFO] Dang Ping kiem tra giao tiep den may Center tai: %CENTER_RUNNER_URL% [cite: 16]
curl -s "%CENTER_RUNNER_URL%/api/jobs" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Worker KHONG THE ket noi den may Center!
  echo Vui long kiem tra 3 dieu sau:
  echo   - 1. Server da duoc khoi dong chua?
  echo   - 2. Tuong lua (Firewall) da mo Inbound cho port 4317 chua?
  echo   - 3. Hai may co dang o chung mang khong? [cite: 16, 17]
  pause
  exit /b 1
)
echo [OK] Giao tiep voi may Center thanh cong! [cite: 17]

echo.
echo ============================================================
echo STEP 4: KÍCH HOẠT WORKERS
echo ============================================================
pushd "%CENTER_RUNNER_ROOT%" [cite: 19]

for /L %%I in (1,1,%WORKER_COUNT%) do (
  set "CURRENT_WORKER_NAME=%WORKER_NAME%-%%I"
  echo Dang khoi chay worker %%I/%WORKER_COUNT%: !CURRENT_WORKER_NAME!
  start "center-runner-worker-%%I" cmd /k "set WORKER_NAME=!CURRENT_WORKER_NAME!&& npm run worker -- --source "%CENTER_RUNNER_COMMAND_SOURCE%" --interval-ms "%CENTER_RUNNER_INTERVAL_MS%"" [cite: 19]
)

popd

echo [OK] Tat ca Workers da duoc kich hoat thanh cong. [cite: 19]
echo. [cite: 20]

:wait
timeout /t 3600 /nobreak >nul
goto wait [cite: 20]