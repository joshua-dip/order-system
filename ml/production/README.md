# 로컬 제작 묶음

로컬 모델의 원래 품질과 Codex 편집 결과를 분리한다. 운영 워커·유료 API 없이 기존 MLX 파이프라인을 일회 실행하고, 적합한 문항만 **대기**로 저장한다. 사람 최종 검수·상품 승인은 별도다.

## 기록 구조

`batches/2026-09-27-jun23-go1-01/`은 첫 제작: 23년 6월 고1 20·22·23번 × 12유형 36회, 최초 대기 저장 27건, 사용자 요청에 따른 개별 AI 재검수 후 **27건 모두 완료**. **이미 저장했으므로 같은 파일을 다시 저장하지 않는다.**

- `manifest.json`: 조회한 원문·지문 ID·모델 설정·코드 버전. 각 슬롯 1회, 내부 재시도 2. 개발 평가의 repeat 2와 다르다.
- `raw.jsonl`: 수정 전 출력과 trace·오류·호출 소요시간. 덮어쓰지 않는다.
- `review.json`: 직접 AI O/P/X/F, 원인, 수정 필드, 보류 여부. 독립 사람 검수 아님.
- `reviewed.json`, `reviewed-keys.json`: 수정 원고와 초안 연결. O 중 표현 정리도 별도 수정으로 센다.
- `save-result.json`: 저장 ID·대기 상태. 재실행 대신 이 결과부터 확인한다.
- `pending-snapshot.json`, `audit.txt`, `stock-{before,after}.json`: 읽기 전용 저장 후 확인·재고.
- `summary.json`: 초안 성적과 수정/대기 수량. 사람 작업시간은 미측정이면 null이며 추정하지 않는다.

## 다음 묶음의 순서

1. 공식 `cc:variant` 조회로 원문·재고를 확인한다. 지문별 유형 적합성을 확인하고 새 batch 디렉터리에 manifest를 준비한다. 같은 지문·유형도 다른 출제 포인트인지 확인한다.
2. `caffeinate -i ml/topic/.venv/bin/python ml/production/generate_batch.py <새-batch-dir>`: 로컬 생성만, DB 쓰기 없음. 파일이 있으면 중복 실행을 거부하고 최대 90분으로 제한한다. 중단분을 완료로 합산하지 않는다.
3. 초안을 직접 풀고 원문·유일성·해설·변별력을 채점한다. `review.json`에 수정 필드를 명시하고 불확실한 문항은 hold한다. F를 수작업 새 문항으로 덮지 않는다.
4. `python3 ml/production/prepare_reviewed.py <batch-dir>`로 대기 저장 입력을 만든다. `npx tsx scripts/cc-variant-prevalidate.ts <batch-dir>/reviewed.json` 통과 후 검토한 새 묶음만 공식 CLI로 한 번 저장한다. **cc:variant save는 dry-run을 지원하지 않는다.**
5. `cc:audit -- --textbook "교재명"`와 실제 대기 재조회로 확인한다. `read_pending.ts`는 기존 조회 함수를 이용하며 최대 30개만 반환하므로 큰 재고에서는 전체 검증으로 오인하지 않는다. 자동 record-review-bulk는 사용하지 않는다.
6. `python3 ml/production/build_review_page.py <batch-dir> <출력.html>`로 검수 페이지를 만든다. 저장된 본문·보기와 수정 원고를 대조하고, 원고의 정답·해설을 저장된 보기 순서로 바꿔 표시한다. DB 정답키를 읽거나 사람 검수 결과를 만드는 도구가 아니다.
7. 노트 개선 기록과 현재 상태·다음 할 일을 갱신한다. 사람 검수시간·최종 판정은 실제 확인 후 기록한다.

첫 묶음의 3지문은 생산·수정에 사용했으므로 독립 평가용 새 지문에서 제외한다. 이번 27건은 사용자가 재학습까지 명시적으로 요청하여, 완료 재조회 후 18건을 LoRA 학습 예시·9건을 규칙 검수 사례로 연결했다. 이후 묶음의 자동 학습 투입과는 구분한다. 생성 코드 개선을 채택하려면 두 기존 개발 세트 전체 repeat 2 전후 평가와 ±7%p 기준을 별도로 지킨다.

## 첫 묶음 완료 검수와 재학습

- `recheck-before.json`, `recheck-patches.json`, `recheck-patch-result.json`: 개별 검수와 변경 전 백업·해시를 확인한 17건 수정(내용 보강 5건 포함).
- `completion-decisions.json`: 27건의 직접 풀이 답과 근거. `review_batch.ts`는 이 결정을 공식 검수 기록 함수로 전달한다. DB 정답을 답안으로 자동 복사하지 않는다.
- `completion-results.json`, `completed-snapshot.json`: 전 건 완료 전환 응답과 재조회. 중복 검수 실행 금지.
- `build_review_page.py --completed`: 재조회한 완료 본문·선지·정답·해설로 표시한다. 최초 대기 저장 기록은 그대로 보존한다.
- `training-feedback/`: 공식 export와 원문·선지·정답·해설이 일치한 18개 LoRA 예시와 규칙 유형 9사례. 사람 검수로 표기하지 않는다.
- `cycles/2026-09-27-fact-production/`: 첫 실험은 fact 어댑터만 추가 학습한다. `train_compare_fact.py`는 두 기준 평가 완료를 확인하고 학습·후속 평가 후 원본 어댑터를 반드시 복원한다. 채택은 별도 채점 이후 판단한다.
- `efficiency.json`: **문제 생성만** 집계한다. 로컬 모델 호출의 Codex 토큰은 0이며, 직접 작성 비교값이 없으면 절약량을 추정하지 않는다. 과거 전체 작업 사용량은 생성 효율에서 제외하는 참고 자료다.

## 첫 재학습 최종 결과

fact 300단계 추가 학습과 두 세트 전체 repeat 2 전후296문항 평가 완료. 고1 O36.84→39.47%, 고2 O44.44→54.17%, F모두0. 고1은 ±7%p 이내이므로 후보 미채택·기존 어댑터 복원 및 SHA 확인. `cycles/2026-09-27-fact-production/comparison.json`과 `ml/eval/grades/`의 네 보고서에 직접 AI 판정·근거·원문·설정·해시가 있다. `publish_fact_grades.py <set> <before|after>`는 명시적 개별 판정을 보고서로 포장하며 자동 채점하지 않는다.

사용자 요청에 따라 현재 작업은 종료했다. 다음 작업 계획은 운영 워커의 묶음 생성→20~30건씩 검수·수정→통과 문항 완료이며 이번에는 시작하지 않는다.
