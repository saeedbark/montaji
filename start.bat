@echo off
rem Starts Montaji and opens the editor in your default browser.
rem Keep this window open while you use the editor; close it to stop.
title Montaji - keep this window open
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   1. Download the LTS version from https://nodejs.org and install it.
  echo   2. Then double-click start.bat again.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node server/index.js --open
if errorlevel 1 pause
