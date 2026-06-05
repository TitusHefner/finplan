@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: create-personal-backup.bat
:: Full personal backup for transferring to a new machine.
:: Includes API keys, .env, and your SQLite database.
:: DO NOT share this archive with anyone.
:: ─────────────────────────────────────────────────────────────────────────────
setlocal

set "ROOT=%~dp0"
set "BACKUP=%ROOT%personal-backup"
set "ZIP=%ROOT%personal-backup.zip"

echo Cleaning previous backup...
if exist "%BACKUP%" rmdir /s /q "%BACKUP%"
if exist "%ZIP%"     del /q "%ZIP%"

echo Copying source code...

:: ── Root files ────────────────────────────────────────────────────────────────
mkdir "%BACKUP%"
copy "%ROOT%docker-compose.yml"   "%BACKUP%\" >nul
copy "%ROOT%Dockerfile.backend"   "%BACKUP%\" >nul
copy "%ROOT%Dockerfile.frontend"  "%BACKUP%\" >nul
copy "%ROOT%README.md"            "%BACKUP%\" >nul
copy "%ROOT%SETUP.md"             "%BACKUP%\" >nul
copy "%ROOT%ROADMAP.md"           "%BACKUP%\" >nul
copy "%ROOT%start.bat"            "%BACKUP%\" >nul
copy "%ROOT%.gitignore"           "%BACKUP%\" >nul
copy "%ROOT%create-dist.bat"      "%BACKUP%\" >nul
copy "%ROOT%dist-exclude.txt"     "%BACKUP%\" >nul
copy "%ROOT%create-personal-backup.bat" "%BACKUP%\" >nul

:: ── Backend (full copy including .env with real keys) ─────────────────────────
robocopy "%ROOT%backend" "%BACKUP%\backend" /E /XF "*.db" "*.sqlite" "*.sqlite3" "*.pyc" "*.pyo" /XD "__pycache__" ".git" ".vscode" ".conda" "node_modules" /NFL /NDL /NJH /NJS /NC /NS >nul

:: ── Frontend ──────────────────────────────────────────────────────────────────
robocopy "%ROOT%frontend\src"    "%BACKUP%\frontend\src"    /E /XD "node_modules" /NFL /NDL /NJH /NJS /NC /NS >nul
robocopy "%ROOT%frontend\public" "%BACKUP%\frontend\public" /E     /NFL /NDL /NJH /NJS /NC /NS >nul
copy  "%ROOT%frontend\package.json"      "%BACKUP%\frontend\" >nul
copy  "%ROOT%frontend\package-lock.json" "%BACKUP%\frontend\" >nul 2>&1

:: ── iOS (Swift) ───────────────────────────────────────────────────────────────
robocopy "%ROOT%ios" "%BACKUP%\ios" /E /NFL /NDL /NJH /NJS /NC /NS >nul

:: ── Database (the important one — your actual financial data) ─────────────────
echo Copying database from AppData...
set "DB_SRC=%LOCALAPPDATA%\SmartBudget\budget.db"
if exist "%DB_SRC%" (
    mkdir "%BACKUP%\database-backup"
    copy "%DB_SRC%" "%BACKUP%\database-backup\budget.db" >nul
    echo   Found and copied budget.db
) else (
    echo   WARNING: No database found at %DB_SRC%
    echo   If your DB is elsewhere, copy it manually to the backup folder.
)

:: ── Write restore instructions ────────────────────────────────────────────────
(
echo # Personal Backup Restore Instructions
echo.
echo ## New Machine Setup
echo.
echo ### 1. Install prerequisites
echo    - Python 3.11+  ^(https://www.python.org/downloads/^)
echo    - Node.js 18+   ^(https://nodejs.org^)
echo    - Miniconda     ^(https://docs.conda.io/en/latest/miniconda.html^)
echo.
echo ### 2. Set up conda environment
echo    conda create -n fin python=3.11 -y
echo    conda activate fin
echo    cd backend
echo    pip install -r requirements.txt
echo.
echo ### 3. Restore your database
echo    The database-backup\budget.db file contains all your financial data.
echo    Copy it to:  %%LOCALAPPDATA%%\SmartBudget\budget.db
echo.
echo    PowerShell one-liner:
echo      $dst = "$env:LOCALAPPDATA\SmartBudget"; New-Item $dst -ItemType Directory -Force; Copy-Item "database-backup\budget.db" "$dst\budget.db"
echo.
echo ### 4. Start the app
echo    Double-click start.bat
echo    Then open http://localhost:3001
echo.
echo ### 5. Your credentials are already in backend\.env — no action needed.
) > "%BACKUP%\RESTORE.txt"

:: ── ZIP it ────────────────────────────────────────────────────────────────────
echo Creating ZIP...
powershell -NoProfile -Command "Compress-Archive -Path '%BACKUP%\*' -DestinationPath '%ZIP%' -Force"

echo.
echo ╔══════════════════════════════════════════════════════════╗
echo ║              PERSONAL BACKUP COMPLETE                   ║
echo ╠══════════════════════════════════════════════════════════╣
echo ║  Folder : personal-backup\                              ║
echo ║  ZIP    : personal-backup.zip                           ║
echo ╠══════════════════════════════════════════════════════════╣
echo ║  CONTAINS SENSITIVE DATA — DO NOT SHARE                 ║
echo ║  Includes: .env keys, database, all source code         ║
echo ╚══════════════════════════════════════════════════════════╝
echo.
pause
