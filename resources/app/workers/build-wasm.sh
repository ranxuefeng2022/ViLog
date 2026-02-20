#!/bin/bash
# WebAssembly 编译脚本

set -e

echo "🔨 开始编译 WebAssembly 模块..."

# 检查 Emscripten 是否安装
if ! command -v emcc &> /dev/null; then
    echo "❌ Emscripten 未安装！"
    echo "请运行以下命令安装："
    echo "  git clone https://github.com/juj/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

# 输出文件（当前目录）
WASM_FILE="timestamp-converter.wasm"
JS_FILE="timestamp-converter.js"

echo "📂 输出目录: $(pwd)"

# 编译选项
EMCC_FLAGS=(
    -O3                    # 最高优化级别
    -s WASM=1              # 生成 WebAssembly
    -s ALLOW_MEMORY_GROWTH=1  # 允许内存增长
    -s EXPORTED_FUNCTIONS='["_convert_line_simple","_set_reference_points","_cleanup_reference_points","_parse_boot_time","_interpolate_utc_time","_format_timestamp","_convert_line","_get_version"]'
    -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","getValue","setValue","stackSave","stackRestore","stackAlloc"]'
    -s MODULARIZE=1        # 模块化输出
    -s EXPORT_NAME="'createTimestampConverter'"
    -s NO_EXIT_RUNTIME=1
    -I .                   # 包含目录
)

# 编译
echo "⚙️  编译 C 代码..."
emcc "${EMCC_FLAGS[@]}" \
    timestamp-converter.c \
    -o "$JS_FILE"

echo ""
echo "✅ 编译完成！"
echo "   WASM 文件: $WASM_FILE"
echo "   JS 胶水文件: $JS_FILE"

# 显示文件大小
if [ -f "$WASM_FILE" ]; then
    WASM_SIZE=$(du -h "$WASM_FILE" | cut -f1)
    echo "   WASM 大小: $WASM_SIZE"
fi

echo ""
echo "🚀 下一步：在 JavaScript 中使用"
echo "   import createTimestampConverter from './timestamp-converter.js';"
echo "   const module = await createTimestampConverter();"
