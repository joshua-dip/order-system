@echo off
REM Paste passage -> multi-stage claim pipeline
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo .venv missing. Run setup.bat first.
  exit /b 1
)

set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
call .venv\Scripts\activate.bat
python pipeline_claim.py --paste %*
endlocal
