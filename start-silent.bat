@echo off
rem 静默启动版：不弹窗口、不自动开浏览器、不等键盘 —— 适合双击或放进 Windows 启动文件夹做开机自启。
rem 用法：双击此文件，或按 Win+R 输入 shell:startup 把本文件的快捷方式拖进去，开机即起。

cd /d "%~dp0"

rem 用 /min 把后端、前端两个 cmd 最小化到任务栏，不在前台挡视线
start "" /min cmd /c "cd backend && npm start"
timeout /t 2 /nobreak >nul
start "" /min cmd /c "cd frontend && npm run dev"

rem 立即退出，不留任何窗口
exit /b 0
