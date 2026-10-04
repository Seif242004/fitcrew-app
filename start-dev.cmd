@echo off
REM FitCrew local dev server. Double-click or run from a terminal in this folder.
REM Uses a local database in .\data and NEVER the GitHub backup, so dev data cannot
REM overwrite the encrypted production copy in fitcrew-data.
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Install Node 22.13+ from https://nodejs.org & pause & exit /b 1)
REM Clear any backup settings inherited from the system so persist.js stays disabled.
set "GITHUB_TOKEN="
set "GITHUB_REPO="
set "FITCREW_GH_TOKEN="
set "FITCREW_GH_REPO="
set "FITCREW_BACKUP_KEY="
set "FITCREW_FORCE_HTTPS="
set "FITCREW_DB=data\fitcrew.db"
set "PORT=3000"
if not exist data mkdir data
REM Settings file (AI key). Accept fitcrew.env, or fitcrew.env.env if Windows added an extra extension.
set "ENVFILE="
if exist "fitcrew.env" set "ENVFILE=fitcrew.env"
if not defined ENVFILE if exist "fitcrew.env.env" set "ENVFILE=fitcrew.env.env"
set "ENVARG="
if defined ENVFILE (set "ENVARG=--env-file=%ENVFILE%" & echo Loaded settings from %ENVFILE%) else (echo No fitcrew.env found: AI plans off, templates only.)
echo FitCrew dev server: http://localhost:3000   (Ctrl+C to stop)
REM No --watch: on Windows it restarts on every file touch (antivirus, editors) and drops
REM connections. Instead the server runs steadily and is restarted only if it crashes.
REM After code updates, close this window and run start-dev.cmd again.
:run
node --no-warnings %ENVARG% server.js
echo.
echo Server stopped (exit code %ERRORLEVEL%). Restarting in 3 seconds... close this window to stop.
timeout /t 3 /nobreak >nul
goto run
