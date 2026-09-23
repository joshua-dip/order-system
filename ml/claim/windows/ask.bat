@echo off
REM 터미널에 지문 붙여넣고 주장 문항 JSON 생성
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo .venv 없음. 먼저 setup.bat 을 실행하세요.
  exit /b 1
)

call .venv\Scripts\activate.bat
python infer.py --paste %*
endlocal
