# Title LoRA Windows one-shot: setup -> export -> train
#   powershell -ExecutionPolicy Bypass -File ml\title\windows\run_all.ps1 -LowVram

param(
  [string]$Model = "Qwen/Qwen2.5-7B-Instruct",
  [int]$MaxSteps = 0,
  [switch]$SkipExport,
  [switch]$SkipTrain,
  [switch]$SmokeOnly,
  [switch]$LowVram
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $Here "..\..\..")

Write-Host "== cwd windows scripts: $Here"
Write-Host "== repo root: $Root"

Set-Location $Here

# venv: this folder's .venv, else the shared ml\topic\windows\.venv (same deps for all three types)
$Py = Join-Path $Here ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) {
  $Shared = Join-Path $Here "..\..\topic\windows\.venv\Scripts\python.exe"
  if (Test-Path $Shared) {
    $Py = $Shared
  } else {
    Write-Host "== setup.bat"
    & cmd /c setup.bat
    if ($LASTEXITCODE -ne 0) { throw "setup.bat failed" }
  }
}
$env:PYTHONUNBUFFERED = "1"

& $Py smoke_check.py
if ($LASTEXITCODE -ne 0) { throw "smoke_check failed" }
if ($SmokeOnly) {
  Write-Host "SmokeOnly done"
  exit 0
}

if (-not $SkipExport) {
  Set-Location $Root
  if (-not (Test-Path ".\.env") -and -not (Test-Path ".\.env.local")) {
    throw "Need .env or .env.local with MONGODB_URI"
  }
  Write-Host "== npm run cc:title-export"
  npm run cc:title-export
  if ($LASTEXITCODE -ne 0) { throw "title-export failed" }
  Set-Location $Here
}

if (-not $SkipTrain) {
  if ($LowVram) {
    Write-Host "== train LOW-VRAM (0.5B, no 4bit) for GTX 1050 Ti"
    $trainArgs = @("train.py", "--low-vram")
    if ($Model -ne "Qwen/Qwen2.5-7B-Instruct") {
      $trainArgs += @("--model", $Model)
    }
    if ($MaxSteps -gt 0) {
      $trainArgs += @("--max-steps", "$MaxSteps")
    }
    & $Py @trainArgs
  } else {
    Write-Host "== train model=$Model maxSteps=$MaxSteps"
    if ($MaxSteps -gt 0) {
      & cmd /c "train.bat `"$Model`" $MaxSteps"
    } else {
      & cmd /c "train.bat `"$Model`""
    }
  }
  if ($LASTEXITCODE -ne 0) { throw "train failed" }
}

Write-Host ""
Write-Host "Done. Infer: ask.bat"
Write-Host "Or from repo root: npm run cc:title-local -- --backend cuda --passage-id PASSAGE_ID"
