# 주제 LoRA — Windows 원클릭 (setup → export → train → smoke)
# 저장소 루트 또는 ml\topic\windows 에서:
#   powershell -ExecutionPolicy Bypass -File ml\topic\windows\run_all.ps1
#   powershell -ExecutionPolicy Bypass -File run_all.ps1 -SkipExport -MaxSteps 100

param(
  [string]$Model = "Qwen/Qwen2.5-7B-Instruct",
  [int]$MaxSteps = 0,
  [switch]$SkipExport,
  [switch]$SkipTrain,
  [switch]$SmokeOnly
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $Here "..\..\..")

Write-Host "== cwd windows scripts: $Here"
Write-Host "== repo root: $Root"

Set-Location $Here

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
  Write-Host "== setup.bat"
  & cmd /c setup.bat
  if ($LASTEXITCODE -ne 0) { throw "setup.bat failed" }
}

& .\.venv\Scripts\python.exe smoke_check.py
if ($LASTEXITCODE -ne 0) { throw "smoke_check failed" }
if ($SmokeOnly) {
  Write-Host "SmokeOnly — 종료"
  exit 0
}

if (-not $SkipExport) {
  Set-Location $Root
  if (-not (Test-Path ".\.env") -and -not (Test-Path ".\.env.local")) {
    throw ".env 또는 .env.local 에 MONGODB_URI 가 필요합니다."
  }
  Write-Host "== npm run cc:topic-export"
  npm run cc:topic-export
  if ($LASTEXITCODE -ne 0) { throw "topic-export failed" }
  Set-Location $Here
}

if (-not $SkipTrain) {
  Write-Host "== train model=$Model maxSteps=$MaxSteps"
  if ($MaxSteps -gt 0) {
    & cmd /c "train.bat `"$Model`" $MaxSteps"
  } else {
    & cmd /c "train.bat `"$Model`""
  }
  if ($LASTEXITCODE -ne 0) { throw "train failed" }
}

Write-Host ""
Write-Host "완료. 추론: ask.bat"
Write-Host "또는 루트에서: set TOPIC_BACKEND=cuda && npm run cc:topic-local -- --passage-id <id>"
