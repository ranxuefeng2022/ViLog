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
echo   Attempting to install Node.js via winget...
echo.

where winget >nul 2>&1
if %errorlevel% equ 0 (
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    if !errorlevel! equ 0 (
        echo.
        echo       Node.js installed successfully.
        echo       Refreshing PATH...
        REM Refresh PATH from registry so we can use node immediately
        for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%b"
        for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%b"
        set "PATH=!SYS_PATH!;!USR_PATH!"

        where node >nul 2>&1
        if !errorlevel! neq 0 (
            echo.
            echo       Cannot detect Node.js yet. Please close this window,
            echo       open a NEW terminal, and run start.bat again.
            pause
            exit /b 1
        )
        for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
        echo       Node.js !NODE_VER! detected after install.
        goto :node_ok
    ) else (
        echo       winget install failed.
    )
) else (
    echo       winget is not available.
)

REM winget not available or failed - try other methods
echo.
echo   winget not available or failed, trying fnm...
where fnm >nul 2>&1
if %errorlevel% equ 0 (
    fnm install --lts
    fnm use lts-latest
    for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
    echo       Node.js !NODE_VER! installed via fnm.
    goto :node_ok
)

echo.
echo   --------------------------------------------
echo   Cannot auto-install Node.js.
echo   Please install Node.js manually:
echo.
echo     Option 1: Download from https://nodejs.org
echo     Option 2: Run in admin PowerShell:
echo               winget install OpenJS.NodeJS.LTS
echo   --------------------------------------------
echo.
echo   After installing, reopen this terminal and run start.bat again.
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

endlocal
