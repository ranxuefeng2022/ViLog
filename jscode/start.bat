@echo off
chcp 65001 >nul 2>&1
title LogView Launcher
setlocal EnableDelayedExpansion

echo ========================================
echo   LogView Launcher
echo ========================================
echo.

REM === Step 1: Check Node.js ===
echo [1/3] Checking Node.js...

where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
    echo       Node.js !NODE_VER! found.
    goto :node_ok
)

echo       Node.js is NOT installed.
echo.

REM --- Method 1: Use local MSI in project root ---
set "LOCAL_MSI="
for %%f in ("%~dp0node-v*-x64.msi") do set "LOCAL_MSI=%%f"
if defined LOCAL_MSI (
    echo       Found local installer: !LOCAL_MSI!
    echo       Installing Node.js...
    msiexec /i "!LOCAL_MSI!" /qn /norestart
    call :refresh_path
    where node >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
        echo       Node.js !NODE_VER! installed successfully.
        goto :node_ok
    )
    echo       Local MSI install failed.
    echo.
)

REM --- Method 2: winget ---
echo       Trying winget...
where winget >nul 2>&1
if !errorlevel! equ 0 (
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    call :refresh_path
    where node >nul 2>&1
    if !errorlevel! equ 0 (
        for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
        echo       Node.js !NODE_VER! installed via winget.
        goto :node_ok
    )
    echo       winget install failed.
    echo.
)

:node_manual
echo.
echo   --------------------------------------------
echo   Cannot auto-install Node.js.
echo   Please download from https://nodejs.org
echo   After installing, reopen this terminal and run start.bat again.
echo   --------------------------------------------
pause
exit /b 1

:node_ok
echo.

REM === Step 2: Check node_modules ===
echo [2/3] Checking dependencies...

if exist "%~dp0node_modules\" (
    echo       node_modules found.
) else (
    echo       node_modules NOT found, running npm install...
    echo.
    cd /d "%~dp0"
    call npm install
    if !errorlevel! neq 0 (
        echo.
        echo       npm install FAILED. Please check the error above.
        pause
        exit /b 1
    )
    echo.
    echo       Dependencies installed successfully.
)
echo.

REM === Step 3: Launch app ===
echo [3/3] Starting LogView...
echo.
cd /d "%~dp0"
call npm start
if %errorlevel% neq 0 (
    echo.
    echo       App exited with error code %errorlevel%.
    pause
)

endlocal
exit /b 0

:refresh_path
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%b"
set "PATH=!SYS_PATH!;!USR_PATH!"
goto :eof
