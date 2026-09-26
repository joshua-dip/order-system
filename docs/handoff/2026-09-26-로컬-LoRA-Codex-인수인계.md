# 로컬 LoRA 변형문제 AI — 인수인계 (2026-09-26)

현재 상태와 다음 할 일만 유지한다. 진행 상세·실험·교훈은 원본 [실습 노트](../ml/lora-notebook/notebook.html)의 1~23과와 「개선 기록」 표에 기록한다. 큰 교훈은 새 과와 목차를 추가한다. **PDF는 사용자 요청 시에만** `node docs/ml/lora-notebook/print-notebook.cjs`로 만든다.

## 현재 상태

- 맥 MLX로 12유형을 생성한다. 초안은 `Qwen2.5-7B-Instruct-4bit` + 유형별 LoRA, 판정·교정·해설은 `Qwen3.6-35B-A3B-4bit`. 순서·삽입·무관한문장·어휘·어법은 규칙 기반으로 LoRA 없이 처리한다.
- 웹 관리자 → `local_variant_jobs` → 맥 워커 → 관리자 검수·저장 구조다. 마지막 확인된 배포는 `efa1290`. 현재 요약 개선은 **전체 품질 검증 전 후보**이며 학습 프롬프트·어댑터는 변경하지 않았다.
- 요약은 완성 문장과 A/B 표현을 받아 코드로 빈칸을 만들고(`ml/common/summary_draft.py`), 원문 요지와 완성 선지의 사실성·문법을 검토한다(`summary_review.py`). 미해결 복수정답·판독 불가·교정 후 미검증은 실패 처리한다. 회귀 테스트 12개 통과.
- 평가 세트는 `sep26-go1`, `jun11-go2`(각 18지문). 새 세트의 수정 전 요약 36문항은 O 14/P 5/X 12/F 5. 개선 후 선택 8문항씩에서는 적절 O가 새 세트 3→6(v1), 기존 세트 2→3(v2). **Codex AI 검토이며 전체 성능 개선은 미입증**이다. 상세 비교·실패 사례는 노트 23과, 채점은 `ml/eval/grades/`에 있다.
- 남은 문제: 근거 인용의 따옴표 변경으로 정상 요지를 거절하고, 검증 모델이 의미 과장·비문을 통과시킨다. 새 세트의 나머지 11유형은 미평가다.
- 마지막 확인 시 이 맥의 `com.gomijoshua.local-variant-worker` launchd 서비스는 미등록, 호환 서버도 미실행이었다. 평가용 MLX는 정상 동작한다. 운영 재개 전에 등록·실행 상태를 확인하고, 파이프라인 변경 시 실행 중인 워커·서버를 재시작한다.

## 다음 할 일

1. 근거 인용을 모델이 다시 쓰는 대신 **원문 문장 번호 선택 → 코드로 원문 회수**를 시험해 잘못된 거절을 줄인다.
2. 의미 과장·문법 오판을 별도 진단하고, 두 평가 세트 전체를 동일 코드로 각 2회 비교한다. 선택 표본 결과와 전체 점수를 섞지 않는다.
3. `jun11-go2`의 나머지 11유형을 평가한다. 이후 빈칸의 복수정답과 주제·제목의 무관 오답 교체를 점검한다.
4. 운영 재개 후 `npm run cc:local-usage`로 초안 대비 저장본의 수정·폐기 비율을 쌓는다. 저장분이 적어 아직 실사용 품질 지표는 부족하다.

## 작업 기준·참조

- **로컬 MLX만 사용, Anthropic API 호출 금지. `MONGODB_URI` 출력 금지. 커밋·푸시·배포는 사용자 요청 시만.** 어댑터·학습 데이터·평가 `runs/`는 git 제외, 채점 `grades/`는 기록 대상이다.
- 평가 교재는 `scripts/_eval-set-filter.ts`로 학습 export에서 제외한다. 새 세트는 `ml/eval/sets/`에 추가한다. 평가 실행은 잠자기 방지를 위해 `caffeinate -i`를 붙인다.
- 평가 명령·라벨·채점 방법: [ml/eval/README.md](../../ml/eval/README.md). 성공 문항의 판정 근거도 보려면 `--keep-trace`.
- Cursor 호환 서버 설정·키·터널·재시작 주의: [cursor-openai-server.md](../ml/cursor-openai-server.md). 워커와 서버가 모델을 각각 올리므로 동시 실행 시 메모리에 유의한다.
- 핵심 코드: `ml/worker/local_variant_worker.py`, `ml/common/mlx_runtime.py`, `ml/summary/windows/pipeline_summary.py`, `ml/common/summary_draft.py`, `ml/common/summary_review.py`.
