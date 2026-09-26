# 고정 평가 세트 (12유형)

고칠 때마다 **같은 시험**을 보고 전후를 비교한다. 손실 숫자나 웹에서 한두 문항 본 인상으로 채택하지 않는다
(실습 노트 6·13과).

| 파일 | 내용 | 커밋 |
|---|---|---|
| `sets/<세트>.json` | 교재·지문 번호·유형, 지문별 채점 기준(`key`)과 알려진 함정(`pitfalls`). 원문은 DB 에서 읽는다 | O |
| `grades/<세트>/<label>.json` | 사람 채점 — `"20번\|topic": "O"` (O 맞음 · P 부분 · X 틀림 · F 실패) + 메모 | O |
| `runs/<세트>/<label>.jsonl` | 실행 결과(선지·정답·해설·경고·로그) | X (gitignore) |

## 돌리기 (맥, 시간은 유형·재시도 횟수에 따라 달라짐)

```bash
ml/topic/.venv/bin/python ml/eval/run_eval.py --set sep26-go1 --label 2026-10-01-무엇을바꿈
python3 ml/eval/view.py --set sep26-go1 --label 2026-10-01-무엇을바꿈            # 문항별 + 자동 지표
python3 ml/eval/view.py --set sep26-go1 --compare 2026-09-24-final,2026-10-01-무엇을바꿈
```

- 한 유형·몇 지문만: `--types claim --nums 20번,30번`. 운의 몫을 줄이려면 `--repeat 2`.
- 성공 문항의 검증 근거까지 조사하려면 `--keep-trace`. 기본은 실패 문항만 trace를 보관한다.
- 모델 세 벌(약 34GB)을 따로 올린다 — 워커가 문항을 만드는 중이면 메모리가 겹치니 한가할 때.
- 채점은 `view.py` 출력의 「기준」 줄(세트의 `key`)에 대어 O/P/X/F 로 적고 `grades/` 에 저장한다.
  자동 지표(성공률·시간·경고·정답 이동·모양 틀린 정답·겹치는 오답 쌍)는 사람 없이도 나온다.

## 세트

- `sep26-go1` — 26년 9월 고1 모의고사 18지문(20~24·29~42번) × 3유형 = 54문항.
  2026-09-24: baseline 맞음 32 → final 48.
  현재는 12유형으로 확장했고, 26번은 일치·불일치 전용으로 추가했다.
- `jun11-go2` — 11년 6월 고2 모의고사 18지문 × 12유형. 번호 체계가 달라 원문을 읽고 선정했다.
  평가 결과를 보기 전에 요지와 함정을 고정했다. 2026-09-26 보관된 여섯 유형의
  `data/*-finetune/*.jsonl` 사용자 입력과 후보 30지문의 정규화 원문 전체·앞/뒤 150자를 대조해 중복 0건.
  기초 모델의 사전학습 노출 여부까지 확인한 것은 아니다. 새로운 세트도 다음 export부터 교재 단위로 제외된다.

```bash
# 요약 기준 평가(18지문 × 2회). 다른 평가와 동시에 실행하면 모델 메모리가 겹친다.
caffeinate -i ml/topic/.venv/bin/python ml/eval/run_eval.py --set jun11-go2 --label <새-라벨> --types summary --repeat 2
python3 ml/eval/dump_summary.py <새-라벨> --set jun11-go2
python3 ml/eval/view.py --set jun11-go2 --report <새-라벨>

# 이후 전 유형 평가: --types를 생략한다(432문항).
# run_eval은 같은 라벨 파일에 덧붙이므로 매 실행마다 고유 라벨을 쓴다.
```

`--report`와 `--compare`는 요약·순서·삽입·무관·어휘·어법을 포함한 12유형을 표시한다.
채점자의 종류는 grades 파일의 `grader`에 명시한다. Codex가 직접 읽은 채점을 사람의 독립 평가로 간주하지 않는다.

## 요약 대안 초안의 실모델 진단

```bash
caffeinate -i ml/topic/.venv/bin/python ml/eval/probe_summary_fallback.py --set sep26-go1 --label <고유-label>-forced-fallback --nums 35번,41~42번 --repeat 2
```

LoRA 응답만 빈 객체로 바꿔 대안 경로를 강제로 호출한다. 35B 생성·검증은 실제 모델이다.
이 결과는 일반 실행의 생성률·내용 적절률과 합치지 않는다. 모델 호출 없는 회귀 검증은
`python3 -m unittest discover -s ml/eval -p 'test_summary_*.py' -v`로 실행한다.

## 요약 의미 검증 진단 (2026-09-26)

`summary_review.py`는 초안을 보기 전 원문 요지와 실제 원문 인용을 받고, 정답을 채운 완성 문장의
요지·사실성·문법을 검토한다. 오답도 정답 힌트 없이 완성 문장별로 확인한다. 판독 불가나 교체 후
미검증 상태를 성공으로 처리하지 않는다. 이 검증은 같은 35B 모델이 하므로 독립적인 정답 보증이 아니다.

- `jun11-go2`의 `summary-semantic-baseline` → `summary-semantic-v1`: 22·28·31·35번 × 2회.
- `sep26-go1`의 `summary-span-fallback` → `summary-semantic-v1` → `summary-semantic-v2`: 30·35·36·41~42번 × 2회.
- 실제 라벨 앞에는 `2026-09-26-`이 붙는다. v2는 근거 인용 불일치 재시도에 피드백만 추가했다.
- 각 결과는 `grades/`에 남긴다. 선택한 오류 사례의 점수이며 전체 18지문 결과와 섞지 않는다.
  특히 35B가 brief를 prompt로 바꿔 읽거나 비문을 마음속으로 고치는 오류는 직접 검토에서 따로 표시한다.
