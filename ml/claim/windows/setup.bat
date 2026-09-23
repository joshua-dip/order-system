@echo off
REM Windows CUDA 환경 1회 세팅 (NVIDIA GPU + Python 3.11/3.12 권장)
setlocal
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo Python 이 PATH 에 없습니다. python.org 에서 3.11+ 설치 후 PATH 에 추가하세요.
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] venv 생성…
  python -m venv .venv
  if errorlevel 1 exit /b 1
)

echo [2/3] PyTorch CUDA 설치…
call .venv\Scripts\activate.bat
python -m pip install -U pip
REM CUDA 12.4 wheel — 드라이버가 오래되면 cu121 로 바꿔 보세요
python -m pip install torch --index-url https://download.pytorch.org/whl/cu124
if errorlevel 1 (
  echo PyTorch 설치 실패. https://pytorch.org 에서 CUDA 버전에 맞는 명령을 확인하세요.
  exit /b 1
)

echo [3/3] transformers / peft / bitsandbytes …
python -m pip install -r requirements.txt
if errorlevel 1 exit /b 1

echo.
python -c "import torch; print('cuda=', torch.cuda.is_available(), 'gpu=', torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)"
echo.
echo 완료. 다음:
echo   1^) 저장소 루트에서: npm run cc:claim-export
echo   2^) 여기로 와서: train.bat
echo   3^) 추론: ask.bat
endlocal
