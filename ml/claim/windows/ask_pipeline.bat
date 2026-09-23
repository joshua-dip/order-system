@echo off
REM Paste passage -> multi-stage claim pipeline
setlocal
cd /d "%~dp0"

REM venv: this folder's .venv, else the shared ml\topic\windows\.venv
set VENV=%~dp0.venv
if not exist "%VENV%\Scripts\python.exe" set VENV=%~dp0..\..\topic\windows\.venv
if not exist "%VENV%\Scripts\python.exe" (
  echo .venv missing. Run ml\topic\windows\setup.bat first - shared by all three types.
  exit /b 1
)

set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
call "%VENV%\Scripts\activate.bat"
python pipeline_claim.py --paste %*
endlocal
