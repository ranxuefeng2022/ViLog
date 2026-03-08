@echo off
chcp 65001 >nul 2>&1  :: 设置编码为UTF-8，避免中文乱码
title 执行npm start (E:\app)  :: 设置cmd窗口标题

:: 1. 检查目标目录是否存在
if not exist "E:\app" (
    echo 错误：目录 E:\app 不存在！
    pause
    exit /b 1
)

:: 2. 进入目标目录
echo 正在进入目录：E:\app
cd /d "E:\app"
if %errorlevel% neq 0 (
    echo 错误：无法进入 E:\app 目录！
    pause
    exit /b 1
)

:: 3. 检查npm是否可用
echo 正在检查npm环境...
npm -v >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误：未检测到npm环境，请先安装Node.js并配置环境变量！
    pause
    exit /b 1
)

:: 4. 执行npm start命令
echo 开始执行 npm start 命令...
echo ==============================================
npm start

:: 5. 命令执行完成后的提示
echo ==============================================
if %errorlevel% equ 0 (
    echo 成功：npm start 执行完成！
) else (
    echo 错误：npm start 执行失败（错误码：%errorlevel%）！
)
pause  :: 防止窗口执行完直接关闭，方便查看日志