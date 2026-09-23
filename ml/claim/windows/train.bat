@echo off
REM 주장 QLoRA 학습 — 사용법: train.bat [모델] [max_steps]
REM   train.bat
REM   train.bat Qwen/Qwen2.5-3B-Instruct 600
REM   train.bat Qwen/Qwen2.5-7B-Instruct 0
setlocal
cd /d "%~dp0"

REM venv: 이 폴더 .venv 가 없으면 세 유형 공용인 ml\topic\windows\.venv 를 쓴다
set VENV=%~dp0.venv
if not exist "%VENV%\Scripts\python.exe" set VENV=%~dp0..\..\topic\windows\.venv
if not exist "%VENV%\Scripts\python.exe" (
  echo .venv 없음. ml\topic\windows\setup.bat 을 먼저 실행하세요. 세 유형 공용 venv 입니다.
  exit /b 1
)
set PYTHONUNBUFFERED=1

set MODEL=%~1
if "%MODEL%"=="" set MODEL=Qwen/Qwen2.5-7B-Instruct
set STEPS=%~2
if "%STEPS%"=="" set STEPS=0

set ROOT=%~dp0..\..\..
if not exist "%ROOT%\data\claim-finetune\train.jsonl" (
  echo train.jsonl 없음. 저장소 루트에서: npm run cc:claim-export
  exit /b 1
)

call "%VENV%\Scripts\activate.bat"
if "%STEPS%"=="0" (
  python train.py --model "%MODEL%" --epochs 1
) else (
  python train.py --model "%MODEL%" --max-steps %STEPS%
)
endlocal
