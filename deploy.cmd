@echo off
REM Puts FitCrew online on Cloudflare (free, no card). Double-click to run.
REM First time: a browser opens - sign in / sign up to Cloudflare and click "Allow".
REM Every later run just uploads the latest code (the crew's data stays in place).
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js not found. Install Node 22.13+ from https://nodejs.org & pause & exit /b 1)

echo.
echo [1/3] Cloudflare sign-in
call npx --yes wrangler@4 whoami | findstr /C:"You are logged in" >nul || call npx --yes wrangler@4 login
if errorlevel 1 (echo Sign-in did not finish. Run deploy.cmd again. & pause & exit /b 1)

echo.
echo [2/3] Uploading the app
call npx --yes wrangler@4 deploy
if errorlevel 1 (echo. & echo Upload failed - see the message above. & pause & exit /b 1)

echo.
echo [3/3] AI key
node scripts\cloud-secret.js

echo.
echo Done. Your link is the https://fitcrew.....workers.dev address printed in step 2.
echo Open it on your phone, create the admin account, then send invites from Admin.
pause
