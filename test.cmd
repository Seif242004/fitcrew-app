@echo off
REM Runs every FitCrew test. Double-click to run. Green = safe to deploy.
setlocal
cd /d "%~dp0"
where node >/dev/null 2>/dev/null || (echo Node.js not found. Install Node 22.13+ from https://nodejs.org & pause & exit /b 1)

echo Running the tests (about a minute)...
echo.
REM Full output goes to test-results.txt; only the summary is shown here.
call npm test > test-results.txt 2>&1
set "RESULT=%errorlevel%"
findstr /R /C:"^# pass" /C:"^# fail" test-results.txt
echo.
if "%RESULT%"=="0" (
  echo All tests passed. You can run deploy.cmd now.
) else (
  echo Some tests failed:
  findstr /C:"not ok" test-results.txt
  echo.
  echo Full details are in test-results.txt. Send them to Claude.
)
pause
