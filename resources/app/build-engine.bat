@echo off
REM Windows 编译脚本 - 需要安装 MinGW-w64 或 MSVC

echo ========================================
echo 编译 Windows 版本的日志服务端
echo ========================================

REM 检查是否安装了 gcc
where gcc >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo 使用 GCC 编译...
    gcc -o vivo_log_engine.exe engine-win.c -lws2_32 -lwinmm -O2 -Wall
    if %ERRORLEVEL% EQU 0 (
        echo 编译成功: vivo_log_engine.exe
        goto :end
    ) else (
        echo GCC 编译失败
        goto :try_cl
    )
) else (
    echo 未找到 GCC，尝试使用 MSVC cl.exe...
    goto :try_cl
)

:try_cl
where cl >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo 使用 MSVC 编译...
    cl /Fe:vivo_log_engine.exe engine-win.c /link ws2_32.lib winmm.lib /O2
    if %ERRORLEVEL% EQU 0 (
        echo 编译成功: vivo_log_engine.exe
        goto :end
    ) else (
        echo MSVC 编译失败
        goto :error
    )
) else (
    echo 未找到 cl.exe
    goto :error
)

:error
echo ========================================
echo 编译失败！
echo ========================================
echo.
echo 请安装以下编译器之一：
echo 1. MinGW-w64: https://www.mingw-w64.org/
echo    或者使用 MSYS2: https://www.msys2.org/
echo 2. Visual Studio Build Tools
echo.
echo 安装后，确保编译器在 PATH 环境变量中
echo.
pause
exit /b 1

:end
echo ========================================
echo 编译完成！
echo ========================================
echo.
echo 运行命令：
echo   vivo_log_engine.exe         - 使用默认端口 8082
echo   vivo_log_engine.exe 9000    - 使用端口 9000
echo.
pause
