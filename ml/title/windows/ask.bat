@echo off
REM 터미널에 지문 붙여넣고 제목 문항 JSON 생성
setlocal
cd /d "%~dp0"

REM venv: 이 폴더 .venv 가 없으면 세 유형 공용인 ml\topic\windows\.venv 를 쓴다
set VENV=%~dp0.venv
if not exist "%VENV%\Scripts\python.exe" set VENV=%~dp0..\..\topic\windows\.venv
if not exist "%VENV%\Scripts\python.exe" (
  echo .venv 없음. ml\topic\windows\setup.bat 을 먼저 실행하세요. 세 유형 공용 venv 입니다.
  exit /b 1
)

call "%VENV%\Scripts\activate.bat"
python infer.py --paste %*
endlocal
