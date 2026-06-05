@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: create-dist.bat
:: Builds a clean distributable ZIP of the Smart Budget App.
:: Excludes: .env, database files, node_modules, __pycache__, .vscode, .conda
:: ─────────────────────────────────────────────────────────────────────────────
setlocal

set "ROOT=%~dp0"
set "DIST=%ROOT%smart-budget-dist"
set "ZIP=%ROOT%smart-budget.zip"

echo Cleaning previous dist...
if exist "%DIST%" rmdir /s /q "%DIST%"
if exist "%ZIP%"  del /q "%ZIP%"

echo Copying files...

:: ── Root files ────────────────────────────────────────────────────────────────
mkdir "%DIST%"
copy "%ROOT%docker-compose.yml"   "%DIST%\" >nul
copy "%ROOT%Dockerfile.backend"   "%DIST%\" >nul
copy "%ROOT%Dockerfile.frontend"  "%DIST%\" >nul
copy "%ROOT%README.md"            "%DIST%\" >nul
copy "%ROOT%SETUP.md"             "%DIST%\" >nul
copy "%ROOT%ROADMAP.md"           "%DIST%\" >nul
copy "%ROOT%start.bat"            "%DIST%\" >nul
copy "%ROOT%.gitignore"           "%DIST%\" >nul

:: ── Backend (robocopy: /E=all subdirs, /XF=exclude files, /XD=exclude dirs) ──
robocopy "%ROOT%backend" "%DIST%\backend" /E /XF ".env" "*.db" "*.sqlite" "*.sqlite3" "*.pyc" "*.pyo" /XD "__pycache__" ".git" ".vscode" ".conda" "node_modules" /NFL /NDL /NJH /NJS /NC /NS >nul

:: Copy the example env (NOT the real .env)
copy "%ROOT%backend\.env.example" "%DIST%\backend\.env.example" >nul

:: ── Frontend ──────────────────────────────────────────────────────────────────
robocopy "%ROOT%frontend\src"    "%DIST%\frontend\src"    /E /XD "node_modules" /NFL /NDL /NJH /NJS /NC /NS >nul
robocopy "%ROOT%frontend\public" "%DIST%\frontend\public" /E     /NFL /NDL /NJH /NJS /NC /NS >nul
copy  "%ROOT%frontend\package.json"      "%DIST%\frontend\" >nul
copy  "%ROOT%frontend\package-lock.json" "%DIST%\frontend\" >nul 2>&1

:: ── iOS (Swift) ───────────────────────────────────────────────────────────────
robocopy "%ROOT%ios" "%DIST%\ios" /E /NFL /NDL /NJH /NJS /NC /NS >nul

:: ── ZIP it ────────────────────────────────────────────────────────────────────
echo Creating ZIP...
powershell -NoProfile -Command "Compress-Archive -Path '%DIST%\*' -DestinationPath '%ZIP%' -Force"

echo.
echo Done!
echo   Folder : %DIST%
echo   ZIP    : %ZIP%
echo.
echo Give your friend either the folder or the ZIP.
echo Remind them to copy backend\.env.example to backend\.env and add their own API keys.
echo.
pause
