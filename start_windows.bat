@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv
  if errorlevel 1 (
    echo Install Python 3.11 from python.org, then run this file again.
    pause
    exit /b 1
  )
)
if not exist ".venv\motorpulse-installed" (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Dependency installation failed. Check the message above and your connection.
    pause
    exit /b 1
  )
  type nul > ".venv\motorpulse-installed"
)
echo Open http://127.0.0.1:5000 in your browser. Press Ctrl+C to stop.
".venv\Scripts\python.exe" app.py
pause
