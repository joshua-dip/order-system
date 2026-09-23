@echo off
REM 로컬 LoRA 워커 — 관리자 화면(배포·로컬)의 「로컬 LoRA로 초안」 작업을 처리한다.
REM 멈추려면 이 창을 닫거나 Ctrl+C. 로그인 시 자동 시작: register_worker_task.ps1
REM   start_worker.bat          평소
REM   start_worker.bat --fake   GPU 없이 큐·화면 연결만 시험
setlocal
cd /d "%~dp0"

set VENV=%LOCAL_VARIANT_VENV%
if "%VENV%"=="" set VENV=%~dp0..\topic\windows\.venv
if not exist "%VENV%\Scripts\python.exe" (
  echo venv 없음: %VENV%
  echo ml\topic\windows\setup.bat 을 먼저 실행하세요. 세 유형 공용 venv 입니다.
  exit /b 1
)

set PYTHONUNBUFFERED=1
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
"%VENV%\Scripts\python.exe" local_variant_worker.py %*
endlocal
