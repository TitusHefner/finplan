@echo off
echo Starting Finance App...

:: Ensure Tailscale is connected (no-op if already up)
echo Connecting Tailscale...
tailscale up
if %errorlevel% neq 0 (
    echo Warning: Tailscale could not connect. Remote access may not work.
)

:: Start backend in a new window
:: --host 0.0.0.0 allows connections from Tailscale and LAN (not just localhost)
start "Backend" cmd /k "cd /d %~dp0backend && C:\Users\Titus\miniconda3\envs\fin\Scripts\uvicorn app.main:app --reload --host 0.0.0.0 --port 5000"

:: Start frontend in a new window
:: HOST=0.0.0.0 allows the React dev server to accept connections from Tailscale
start "Frontend" cmd /k "cd /d %~dp0frontend && set PORT=3001 && set HOST=0.0.0.0 && set PATH=C:\Users\Titus\miniconda3\envs\fin;%PATH% && C:\Users\Titus\miniconda3\envs\fin\node.exe C:\Users\Titus\miniconda3\envs\fin\node_modules\npm\bin\npm-cli.js start"

echo Both services are starting in separate windows.
