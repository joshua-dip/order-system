@echo off
REM Train explanation-only LoRA (uses data/claim-explain-finetune)
REM   train_explain.bat
REM   train_explain.bat 400
setlocal
cd /d "%~dp0"

REM venv: this folder's .venv, else the shared ml\topic\windows\.venv
set VENV=%~dp0.venv
if not exist "%VENV%\Scripts\python.exe" set VENV=%~dp0..\..\topic\windows\.venv
if not exist "%VENV%\Scripts\python.exe" (
  echo .venv missing. Run ml\topic\windows\setup.bat first - shared by all three types.
  exit /b 1
)
set PYTHONUNBUFFERED=1

set ROOT=%~dp0..\..\..
set DATA=%ROOT%\data\claim-explain-finetune
set ADAPTER=%~dp0..\adapters\claim-explain-lora-cuda
set STEPS=%~1
if "%STEPS%"=="" set STEPS=400

if not exist "%DATA%\train.jsonl" (
  echo train.jsonl missing. From repo root:
  echo   npm run cc:claim-explain-export
  exit /b 1
)

call "%VENV%\Scripts\activate.bat"
echo == explain LoRA low-vram steps=%STEPS%
python train.py --low-vram --data "%DATA%" --adapter "%ADAPTER%" --max-steps %STEPS%
endlocal
