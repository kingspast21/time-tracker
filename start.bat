@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install
  if errorlevel 1 goto fail
)
echo Building...
call npm run build
if errorlevel 1 goto fail
call npm start
exit /b 0

:fail
echo Something went wrong. See the messages above.
pause
exit /b 1
