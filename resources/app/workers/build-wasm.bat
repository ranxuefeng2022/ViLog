@echo off
REM WebAssembly 编译脚本 (Windows)

echo 🔨 开始编译 WebAssembly 模块...

REM 检查 Emscripten 是否安装
where emcc >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Emscripten 未安装！
    echo 请运行以下命令安装：
    echo   git clone https://github.com/juj/emsdk.git
    echo   cd emsdk
    echo   emsdk install latest
    echo   emsdk activate latest
    echo   emsdk_env.bat
    pause
    exit /b 1
)

REM 输出文件（当前目录）
set JS_FILE=timestamp-converter.js
set WASM_FILE=timestamp-converter.wasm

echo 📂 输出目录: %CD%

REM 编译
echo ⚙️  编译 C 代码...
emcc -O3 ^
    -s WASM=1 ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s EXPORTED_FUNCTIONS=["_convert_line_simple","_set_reference_points","_cleanup_reference_points","_parse_boot_time","_interpolate_utc_time","_format_timestamp","_convert_line","_get_version"] ^
    -s EXPORTED_RUNTIME_METHODS=["cwrap","ccall","getValue","setValue","stackSave","stackRestore","stackAlloc"] ^
    -s MODULARIZE=1 ^
    -s EXPORT_NAME="'createTimestampConverter'" ^
    -s NO_EXIT_RUNTIME=1 ^
    -I . ^
    timestamp-converter.c ^
    -o %JS_FILE%

echo.
echo ✅ 编译完成！
echo    WASM 文件: %WASM_FILE%
echo    JS 胶水文件: %JS_FILE%

pause
