@echo off
REM Train explanation-only LoRA (uses data/title-explain-finetune)
REM   train_explain.bat
REM   train_explain.bat 400
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo .venv missing. Run setup.bat first.
  exit /b 1
)

set ROOT=%~dp0..\..\..
set DATA=%ROOT%\data\title-explain-finetune
set ADAPTER=%~dp0..\adapters\title-explain-lora-cuda
set STEPS=%~1
if "%STEPS%"=="" set STEPS=400

if not exist "%DATA%\train.jsonl" (
  echo train.jsonl missing. From repo root:
  echo   npm run cc:title-explain-export
  exit /b 1
)

call .venv\Scripts\activate.bat
echo == explain LoRA low-vram steps=%STEPS%
python train.py --low-vram --data "%DATA%" --adapter "%ADAPTER%" --max-steps %STEPS%
endlocal
