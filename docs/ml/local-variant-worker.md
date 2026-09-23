# 로컬 LoRA 워커 — 관리자 화면(배포 포함)에서 주제·제목·주장 초안 만들기

관리자 화면 「로컬 LoRA로 초안」 버튼은 작업을 MongoDB 에 넣기만 한다. **이 GPU PC 에서 워커가 돌고 있어야**
실제로 만들어진다. 배포 사이트(Amplify)에서 눌러도 똑같이 이 PC 가 처리한다. Anthropic/Claude 는 쓰지 않는다.

```
관리자 화면 ──등록──▶ local_variant_jobs ◀──집기·결과── GPU PC 워커 ──▶ 자식 프로세스(모델)
      ▲ 3초 폴링                                       └─ local_variant_workers 하트비트(15초)
```

필드·상태 규약: [`docs/handoff/2026-09-23-로컬-LoRA-작업큐.md`](../handoff/2026-09-23-로컬-LoRA-작업큐.md)

## 준비 (한 번)

1. 세 유형 공용 venv: `ml\topic\windows\setup.bat` (이미 있으면 생략)
2. 워커 의존성: `ml\topic\windows\.venv\Scripts\python.exe -m pip install -r ml\worker\requirements.txt`
3. 저장소 루트 `.env.local` 에 `MONGODB_URI` (웹앱과 같은 파일, 워커는 값을 출력하지 않는다)
4. 어댑터: `ml/<topic|title|claim>/adapters/<type>-lora-cuda/` — 학습된 유형만 버튼이 켜진다

## 실행

로그인할 때 **창 없이** 자동으로 띄운다(권장, 한 번만 등록):

```bat
powershell -ExecutionPolicy Bypass -File ml\worker\register_worker_task.ps1
```

| 하려는 것 | 명령 (PowerShell) |
|---|---|
| 지금 시작 | `Start-ScheduledTask -TaskName gomijoshua-local-variant-worker` |
| 멈춤 | `Stop-ScheduledTask -TaskName gomijoshua-local-variant-worker` — 다시 시작하거나 다음 로그인 때까지 꺼져 있다 |
| 돌고 있나 | 관리자 화면 「GPU 워커 온라인」, 또는 `Get-ScheduledTask -TaskName gomijoshua-local-variant-worker` 의 State 가 `Running` |
| 로그 | `ml\worker\logs\worker.log` (시작할 때 5MB 넘으면 `worker.1.log` 로 넘김) |
| 등록 해제 | `Unregister-ScheduledTask -TaskName gomijoshua-local-variant-worker -Confirm:$false` |

- 창이 없어서 실수로 닫아 멈출 일이 없다. 로그인 직후 네트워크가 아직 없거나 도중에 끊겨도 끝나지 않고 계속 다시 시도한다.
- **작업 스케줄러는 끝난 워커를 다시 띄우지 않는다** — 재시작 설정은 실행 자체가 실패했을 때만 적용된다.
- **우선순위는 보통(4)으로 등록한다.** 작업 스케줄러 기본값(7)은 「보통 이하」라, 같은 코드가 직접 돌릴 때보다
  모델 올리기·생성 모두 4~7배 느렸다(0.5B 는 CPU 쪽 처리가 대부분이다).
- **워커·추론 자식은 시작할 때 Windows 효율 모드(EcoQoS)를 끈다**(`ml/common/win_qos.py`). 화면 없는 백그라운드 프로세스는
  Windows 11 이 알아서 효율 코어·낮은 클럭으로 돌려(하이브리드 CPU, i5-14400F), 우선순위를 고친 뒤에도 3배 느렸다.
  두 가지를 고친 뒤 한 문항: 모델 올리기 11초 + 생성 약 32초(전에는 4분 반~6분 반).
- 학습을 하지 않는 PC 면 `-IdleUnloadMin 1440` 으로 등록해 모델을 내려놓지 않게 한다 — 요청마다 모델을 올리는 대기가 없어진다.
  (기본 10분은 같은 GPU 로 학습할 자리를 비우려는 것.) 다시 등록한 설정은 워커를 멈췄다 켜야 적용된다.

콘솔 창에서 직접 돌리기(시험·문제 확인용 — 창을 닫거나 Ctrl+C 로 멈춘다). 자동 시작 워커가 돌고 있으면 먼저 멈춘다:

```bat
ml\worker\start_worker.bat           REM 창에서 상주
ml\worker\start_worker.bat --fake    REM GPU 없이 큐·화면 연결만 시험(고정 결과, 저장 금지 표시)
ml\worker\start_worker.bat --once    REM 한 건만 처리하고 끝
```

절전 모드에서는 워커도 멈춘다 — 이 PC 의 절전 설정은 따로 꺼 둔다.
워커는 PC 마다 하나만 뜬다(`ml/worker/.worker.lock`) — 이미 돌고 있으면 나중에 띄운 쪽이 바로 끝난다.

## GPU 를 학습과 나눠 쓰는 규칙 (4GB)

- 워커는 **여유 VRAM 이 2600MB 이상일 때만** 모델을 올린다(`--min-free-mb`). 학습 중(여유 1GB 남짓)이면
  작업을 집지 않고 기다린다 — 화면에는 「대기 · GPU 사용 중(학습 중?)」.
- 모델은 **자식 프로세스**에 올린다. 작업이 없으면 10분 뒤(`--idle-unload-min`) 자식을 끝내 CUDA 메모리를
  통째로 돌려준다 — 그다음에 학습을 시작하면 된다. 하트비트의 `model_loaded` 로 확인.
- 학습 도중 워커가 모델을 올릴 일은 없지만, **모델을 올려 둔 채 학습을 시작하면 학습이 메모리 부족으로 죽을 수 있다.**
  학습 전엔 워커를 멈추거나(`Stop-ScheduledTask …`) 모델이 내려간 상태인지 본다.
- CLI(`npm run cc:local-variant …`)는 워커를 거치지 않고 파이썬을 직접 띄운다 — 워커가 모델을 올려 둔 상태면 쓰지 않는다.

## 상태 보기

화면 버튼 옆에 「GPU 워커 온라인」·「오프라인(마지막 신호 n분 전)」·「주제 미학습」이 뜬다.
작업을 넣은 뒤에는 「대기 · 앞에 n건」 → 「<PC 이름>에서 생성 중」 → 편집창 채움(검증 경고가 있으면 노란 상자).
워커 로그(`ml\worker\logs\worker.log`, 콘솔로 돌렸으면 그 창)에는 작업 시작·완료·실패와 파이프라인 진행(`| [pipeline] …`)이 찍힌다.

## 옵션

| 옵션 | 기본 | 설명 |
|---|---|---|
| `--types 주제,제목` | 전부 | 이 워커가 맡을 유형 |
| `--min-free-mb` | 2600 | 모델을 올리기 전에 필요한 GPU 여유 메모리 |
| `--idle-unload-min` | 10 | 작업이 없으면 모델을 내려놓기까지 |
| `--lease-min` | 15 | 생성 중 lease(15초마다 연장) — 워커가 죽으면 이 뒤에 다시 집힌다 |
| `--load-timeout-sec` · `--gen-timeout-sec` | 900 | 모델 로드·생성 한도 |
