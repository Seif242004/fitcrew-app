@echo off
REM Publishes this folder to GitHub (github.com/Seif242004/fitcrew-app), keeping the repo's history.
REM Double-click to run. Optional: publish-github.cmd "What changed"
REM First time only: Git for Windows opens a browser window so you can sign in to GitHub yourself.
REM Never published: fitcrew.env (AI key), data\ (database), .wrangler\, private notes (see .gitignore).
setlocal
cd /d "%~dp0"
set "REPO=https://github.com/Seif242004/fitcrew-app.git"
where git >nul 2>nul || (echo Git not found. Install Git for Windows from https://git-scm.com/download/win and run this again. & pause & exit /b 1)

echo.
echo [1/4] Connecting to GitHub
if not exist .git git init -q -b main
git remote get-url origin >nul 2>nul || git remote add origin %REPO%
REM Commit identity for this repo only. GitHub's no-reply address keeps your real email private.
git config user.name >nul 2>nul || git config user.name "Seif Tamer"
git config user.email >nul 2>nul || git config user.email "123273307+Seif242004@users.noreply.github.com"
git fetch -q origin || (echo Could not reach GitHub. Check the internet connection or finish the sign-in, then run this again. & pause & exit /b 1)
REM First run: adopt the history already on GitHub without touching any file in this folder.
git rev-parse -q --verify HEAD >nul 2>nul || (git update-ref refs/heads/main origin/main & git symbolic-ref HEAD refs/heads/main)

echo.
echo [2/4] Collecting changes
REM Rebuild the index from this folder, so the repo matches it exactly (minus .gitignore).
git rm -r -q --cached . >nul 2>nul
git add -A
REM Safety net: never publish secrets or the database, even if .gitignore is changed by mistake.
git diff --cached --name-only | findstr /I /R "fitcrew\.env \.env$ \.db$ \.db-wal$ \.db-shm$ ^data/ ^\.wrangler/" && (echo. & echo Stopped: a settings or database file was about to be published. Nothing was sent. & git reset -q & pause & exit /b 1)
git grep --cached -q -I -E "nvapi-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|BEGIN [A-Z ]*PRIVATE KEY" && (echo. & echo Stopped: something that looks like a key or token is in the files. Nothing was sent. & git reset -q & pause & exit /b 1)
git status --short
git diff --cached --quiet && (echo Nothing new to commit. & goto push)

echo.
echo [3/4] Saving a commit
if exist publish-message.txt (
  git commit -q -F publish-message.txt || (pause & exit /b 1)
  del publish-message.txt
) else (
  if "%~1"=="" (git commit -q -m "Update FitCrew") else (git commit -q -m "%~1")
)

:push
echo.
echo [4/4] Uploading
git push -u origin main || (echo. & echo Upload failed - see the message above. & pause & exit /b 1)
echo.
echo Done: https://github.com/Seif242004/fitcrew-app
pause
