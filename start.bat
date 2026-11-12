@echo off
rem Starts the local server and opens the editor in your default browser.
cd /d "%~dp0"
start "" http://localhost:5173
node .claude\serve.js
