@echo off
REM 제목 QLoRA 학습 — 사용법: train.bat [모델] [max_steps]
REM   train.bat
REM   train.bat Qwen/Qwen2.5-3B-Instruct 600
REM   train.bat Qwen/Qwen2.5-7B-Instruct 0
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo .venv 없음. 먼저 setup.bat 을 실행하세요.
  exit /b 1
)

set MODEL=%~1
if "%MODEL%"=="" set MODEL=Qwen/Qwen2.5-7B-Instruct
set STEPS=%~2
if "%STEPS%"=="" set STEPS=0

set ROOT=%~dp0..\..\..
if not exist "%ROOT%\data\title-finetune\train.jsonl" (
  echo train.jsonl 없음. 저장소 루트에서: npm run cc:title-export
  exit /b 1
)

call .venv\Scripts\activate.bat
if "%STEPS%"=="0" (
  python train.py --model "%MODEL%" --epochs 1
) else (
  python train.py --model "%MODEL%" --max-steps %STEPS%
)
endlocal
