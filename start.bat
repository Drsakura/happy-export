@echo off
chcp 65001 >nul
echo ========================================
echo   外贸供应链管理系统
echo ========================================
echo.

cd /d "%~dp0"

echo 正在启动后端服务器...
cd backend
start "后端服务器" cmd /k "npm start"

timeout /t 2 >nul

echo 正在启动前端开发服务器...
cd ..\frontend
start "前端开发服务器" cmd /k "npm run dev"

timeout /t 3 >nul

echo.
echo ✓ 服务已启动
echo.
echo 前端地址: http://127.0.0.1:5300
echo 后端地址: http://127.0.0.1:4300
echo.
echo 按任意键打开浏览器...
pause >nul

start http://127.0.0.1:5300

echo.
echo 提示: 关闭服务请关闭对应的命令行窗口
pause
