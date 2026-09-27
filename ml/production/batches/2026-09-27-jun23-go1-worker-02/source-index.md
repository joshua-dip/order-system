# 23년 6월 고1 — 워커 제작 내역

기준 시각: 2026-09-27T06:46:18.119Z / 검수하지 않음 / 생성 97건 · 실패 2건 · 저장 97건 · 대기 상태 97건

generation_seconds is recorded pipeline time including internal checks/retries/explanation, excluding queue wait/model load; not isolated first-draft decoding. Worker processing includes model loading and overhead; for retried jobs claimed_at covers latest attempt. Missing values are unmeasured, not zero.

| 번호 | 출처 | 유형 | 생성 초 | 작업 초 | 문항 고유ID | 일련번호 | 상태 | 작업ID | 기본 모델 | 어댑터 | 추론 모델 |
|---|---|---|---:|---:|---|---|---|---|---|---|---|
| 1 | 23년 6월 고1 영어모의고사 21번 | 주제 | 45.89 | 57.65 | 6ab8bb6530f57dbeaea6363d | 197373 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a8e | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 2 | 23년 6월 고1 영어모의고사 21번 | 제목 | 16.37 | 16.41 | 6ab8bb6530f57dbeaea6363e | 197374 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a8f | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 3 | 23년 6월 고1 영어모의고사 21번 | 일치 | 21.47 | 21.50 | 6ab8bb6530f57dbeaea6363f | 197375 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a90 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 4 | 23년 6월 고1 영어모의고사 21번 | 불일치 | 12.41 | 12.44 | 6ab8bb6530f57dbeaea63640 | 197376 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a91 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 5 | 23년 6월 고1 영어모의고사 21번 | 빈칸 | 11.87 | 11.90 | 6ab8bb6530f57dbeaea63641 | 197377 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a92 | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 6 | 23년 6월 고1 영어모의고사 21번 | 요약 | 23.29 | 23.32 | 6ab8bb6630f57dbeaea63642 | 197378 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a93 | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 7 | 23년 6월 고1 영어모의고사 21번 | 순서 | 11.09 | 11.12 | 6ab8bb6630f57dbeaea63643 | 197379 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a94 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 8 | 23년 6월 고1 영어모의고사 21번 | 삽입 | 6.33 | 6.36 | 6ab8bb6630f57dbeaea63644 | 197380 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a95 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 9 | 23년 6월 고1 영어모의고사 21번 | 무관한문장 | 7.27 | 7.30 | 6ab8bb6630f57dbeaea63645 | 197381 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a96 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 10 | 23년 6월 고1 영어모의고사 21번 | 어휘 | 4.70 | 4.73 | 6ab8bb6630f57dbeaea63646 | 197382 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a97 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 11 | 23년 6월 고1 영어모의고사 21번 | 어법 | 7.86 | 7.89 | 6ab8bb6630f57dbeaea63647 | 197383 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a98 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 12 | 23년 6월 고1 영어모의고사 21번 | 주장 | 11.48 | 11.51 | 6ab8bb6630f57dbeaea63648 | 197384 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a99 | mlx-community/Qwen2.5-7B-Instruct-4bit | claim | mlx-community/Qwen3.6-35B-A3B-4bit |
| 13 | 23년 6월 고1 영어모의고사 24번 | 주제 | 17.58 | 17.61 | 6ab8bb6630f57dbeaea63649 | 197385 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a9a | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 14 | 23년 6월 고1 영어모의고사 24번 | 제목 | 18.34 | 18.38 | 6ab8bb6630f57dbeaea6364a | 197386 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a9b | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 15 | 23년 6월 고1 영어모의고사 24번 | 일치 | 15.17 | 15.20 | 6ab8bb6630f57dbeaea6364b | 197387 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a9c | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 16 | 23년 6월 고1 영어모의고사 24번 | 불일치 | 14.09 | 14.13 | 6ab8bb6630f57dbeaea6364c | 197388 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a9d | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 17 | 23년 6월 고1 영어모의고사 24번 | 빈칸 | 42.12 | 42.15 | 6ab8bb6630f57dbeaea6364d | 197389 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414a9e | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 18 | 23년 6월 고1 영어모의고사 24번 | 요약 | — | 47.19 | — | — | 미저장 / 생성 실패 | 6ab8b589f4e8fd7445414a9f | mlx-community/Qwen2.5-7B-Instruct-4bit | 미기록 | mlx-community/Qwen3.6-35B-A3B-4bit |
| 19 | 23년 6월 고1 영어모의고사 24번 | 순서 | 3.60 | 3.64 | 6ab8bb6630f57dbeaea6364e | 197390 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414aa0 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 20 | 23년 6월 고1 영어모의고사 24번 | 무관한문장 | 11.79 | 11.82 | 6ab8bb6630f57dbeaea6364f | 197391 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414aa1 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 21 | 23년 6월 고1 영어모의고사 24번 | 어휘 | 8.53 | 8.56 | 6ab8bb6630f57dbeaea63650 | 197392 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414aa2 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 22 | 23년 6월 고1 영어모의고사 24번 | 어법 | 4.16 | 4.19 | 6ab8bb6630f57dbeaea63651 | 197393 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414aa3 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 23 | 23년 6월 고1 영어모의고사 29번 | 주제 | 17.66 | 17.70 | 6ab8bb6630f57dbeaea63652 | 197394 | 대기 / 초안 생성됨 | 6ab8b589f4e8fd7445414aa4 | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 24 | 23년 6월 고1 영어모의고사 29번 | 제목 | 17.44 | 17.47 | 6ab8bb6630f57dbeaea63653 | 197395 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aa5 | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 25 | 23년 6월 고1 영어모의고사 29번 | 일치 | 19.71 | 19.74 | 6ab8bb6630f57dbeaea63654 | 197396 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aa6 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 26 | 23년 6월 고1 영어모의고사 29번 | 불일치 | 12.18 | 12.22 | 6ab8bb6630f57dbeaea63655 | 197397 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aa7 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 27 | 23년 6월 고1 영어모의고사 29번 | 빈칸 | 35.61 | 35.64 | 6ab8bb6730f57dbeaea63656 | 197398 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aa8 | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 28 | 23년 6월 고1 영어모의고사 29번 | 요약 | 16.37 | 16.40 | 6ab8bb6730f57dbeaea63657 | 197399 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aa9 | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 29 | 23년 6월 고1 영어모의고사 29번 | 순서 | 3.33 | 3.36 | 6ab8bb6730f57dbeaea63658 | 197400 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aaa | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 30 | 23년 6월 고1 영어모의고사 29번 | 삽입 | 2.90 | 2.93 | 6ab8bb6730f57dbeaea63659 | 197401 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aab | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 31 | 23년 6월 고1 영어모의고사 29번 | 무관한문장 | 8.03 | 8.05 | 6ab8bb6730f57dbeaea6365a | 197402 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aac | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 32 | 23년 6월 고1 영어모의고사 29번 | 어휘 | 4.18 | 4.21 | 6ab8bb6730f57dbeaea6365b | 197403 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aad | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 33 | 23년 6월 고1 영어모의고사 29번 | 어법 | 5.47 | 5.50 | 6ab8bb6730f57dbeaea6365c | 197404 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aae | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 34 | 23년 6월 고1 영어모의고사 30번 | 주제 | 13.89 | 13.92 | 6ab8bb6730f57dbeaea6365d | 197405 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aaf | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 35 | 23년 6월 고1 영어모의고사 30번 | 제목 | 18.81 | 18.85 | 6ab8bb6730f57dbeaea6365e | 197406 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab0 | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 36 | 23년 6월 고1 영어모의고사 30번 | 일치 | 20.92 | 21.01 | 6ab8bb6730f57dbeaea6365f | 197407 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab1 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 37 | 23년 6월 고1 영어모의고사 30번 | 불일치 | 13.60 | 13.63 | 6ab8bb6730f57dbeaea63660 | 197408 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab2 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 38 | 23년 6월 고1 영어모의고사 30번 | 빈칸 | 14.68 | 14.71 | 6ab8bb6730f57dbeaea63661 | 197409 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab3 | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 39 | 23년 6월 고1 영어모의고사 30번 | 요약 | 25.86 | 25.89 | 6ab8bb6730f57dbeaea63662 | 197410 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab4 | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 40 | 23년 6월 고1 영어모의고사 30번 | 순서 | 3.42 | 3.45 | 6ab8bb6730f57dbeaea63663 | 197411 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab5 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 41 | 23년 6월 고1 영어모의고사 30번 | 삽입 | 5.26 | 5.29 | 6ab8bb6730f57dbeaea63664 | 197412 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab6 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 42 | 23년 6월 고1 영어모의고사 30번 | 무관한문장 | 4.89 | 4.92 | 6ab8bb6730f57dbeaea63665 | 197413 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab7 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 43 | 23년 6월 고1 영어모의고사 30번 | 어휘 | 3.93 | 3.96 | 6ab8bb6730f57dbeaea63666 | 197414 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab8 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 44 | 23년 6월 고1 영어모의고사 30번 | 어법 | 4.58 | 4.61 | 6ab8bb6730f57dbeaea63667 | 197415 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ab9 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 45 | 23년 6월 고1 영어모의고사 31번 | 주제 | 17.89 | 17.92 | 6ab8bb6730f57dbeaea63668 | 197416 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414aba | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 46 | 23년 6월 고1 영어모의고사 31번 | 제목 | 20.36 | 20.40 | 6ab8bb6830f57dbeaea63669 | 197417 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414abb | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 47 | 23년 6월 고1 영어모의고사 31번 | 일치 | 15.22 | 15.25 | 6ab8bb6830f57dbeaea6366a | 197418 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414abc | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 48 | 23년 6월 고1 영어모의고사 31번 | 불일치 | 14.34 | 14.43 | 6ab8bb6830f57dbeaea6366b | 197419 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414abd | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 49 | 23년 6월 고1 영어모의고사 31번 | 빈칸 | 20.34 | 20.37 | 6ab8bb6830f57dbeaea6366c | 197420 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414abe | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 50 | 23년 6월 고1 영어모의고사 31번 | 요약 | 22.84 | 22.87 | 6ab8bb6830f57dbeaea6366d | 197421 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414abf | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 51 | 23년 6월 고1 영어모의고사 31번 | 순서 | 3.62 | 3.65 | 6ab8bb6830f57dbeaea6366e | 197422 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ac0 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 52 | 23년 6월 고1 영어모의고사 31번 | 삽입 | 2.60 | 2.63 | 6ab8bb6830f57dbeaea6366f | 197423 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ac1 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 53 | 23년 6월 고1 영어모의고사 31번 | 무관한문장 | 4.96 | 4.99 | 6ab8bb6830f57dbeaea63670 | 197424 | 대기 / 초안 생성됨 | 6ab8b58af4e8fd7445414ac2 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 54 | 23년 6월 고1 영어모의고사 31번 | 어휘 | 4.83 | 4.87 | 6ab8bb6830f57dbeaea63671 | 197425 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ac3 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 55 | 23년 6월 고1 영어모의고사 31번 | 어법 | 4.10 | 4.13 | 6ab8bb6830f57dbeaea63672 | 197426 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ac4 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 56 | 23년 6월 고1 영어모의고사 32번 | 주제 | 15.48 | 15.51 | 6ab8bb6830f57dbeaea63673 | 197427 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ac5 | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 57 | 23년 6월 고1 영어모의고사 32번 | 제목 | 17.93 | 17.96 | 6ab8bb6830f57dbeaea63674 | 197428 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ac6 | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 58 | 23년 6월 고1 영어모의고사 32번 | 일치 | 13.95 | 13.98 | 6ab8bb6830f57dbeaea63675 | 197429 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ac7 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 59 | 23년 6월 고1 영어모의고사 32번 | 불일치 | 12.82 | 12.85 | 6ab8bb6830f57dbeaea63676 | 197430 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ac8 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 60 | 23년 6월 고1 영어모의고사 32번 | 빈칸 | 12.67 | 12.71 | 6ab8bb6830f57dbeaea63677 | 197431 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ac9 | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 61 | 23년 6월 고1 영어모의고사 32번 | 요약 | 35.33 | 35.42 | 6ab8bb6830f57dbeaea63678 | 197432 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414aca | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 62 | 23년 6월 고1 영어모의고사 32번 | 순서 | 9.67 | 9.70 | 6ab8bb6830f57dbeaea63679 | 197433 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414acb | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 63 | 23년 6월 고1 영어모의고사 32번 | 삽입 | 9.13 | 9.16 | 6ab8bb6830f57dbeaea6367a | 197434 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414acc | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 64 | 23년 6월 고1 영어모의고사 32번 | 무관한문장 | 4.18 | 4.21 | 6ab8bb6830f57dbeaea6367b | 197435 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414acd | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 65 | 23년 6월 고1 영어모의고사 32번 | 어휘 | 5.04 | 5.08 | 6ab8bb6930f57dbeaea6367c | 197436 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ace | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 66 | 23년 6월 고1 영어모의고사 32번 | 어법 | 3.85 | 3.88 | 6ab8bb6930f57dbeaea6367d | 197437 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414acf | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 67 | 23년 6월 고1 영어모의고사 33번 | 주제 | 17.42 | 17.45 | 6ab8bb6930f57dbeaea6367e | 197438 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad0 | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 68 | 23년 6월 고1 영어모의고사 33번 | 제목 | 16.28 | 16.31 | 6ab8bb6930f57dbeaea6367f | 197439 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad1 | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 69 | 23년 6월 고1 영어모의고사 33번 | 일치 | 21.01 | 21.04 | 6ab8bb6930f57dbeaea63680 | 197440 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad2 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 70 | 23년 6월 고1 영어모의고사 33번 | 불일치 | 12.75 | 12.79 | 6ab8bb6930f57dbeaea63681 | 197441 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad3 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 71 | 23년 6월 고1 영어모의고사 33번 | 빈칸 | 13.29 | 13.32 | 6ab8bb6930f57dbeaea63682 | 197442 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad4 | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 72 | 23년 6월 고1 영어모의고사 33번 | 요약 | 25.62 | 25.65 | 6ab8bb6930f57dbeaea63683 | 197443 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad5 | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 73 | 23년 6월 고1 영어모의고사 33번 | 순서 | 2.76 | 2.79 | 6ab8bb6930f57dbeaea63684 | 197444 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad6 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 74 | 23년 6월 고1 영어모의고사 33번 | 삽입 | — | 10.20 | — | — | 미저장 / 생성 실패 | 6ab8b58bf4e8fd7445414ad7 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 75 | 23년 6월 고1 영어모의고사 33번 | 무관한문장 | 21.13 | 21.16 | 6ab8bb6930f57dbeaea63685 | 197445 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad8 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 76 | 23년 6월 고1 영어모의고사 33번 | 어휘 | 4.87 | 4.90 | 6ab8bb6930f57dbeaea63686 | 197446 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ad9 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 77 | 23년 6월 고1 영어모의고사 33번 | 어법 | 4.28 | 4.31 | 6ab8bb6930f57dbeaea63687 | 197447 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ada | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 78 | 23년 6월 고1 영어모의고사 34번 | 주제 | 14.91 | 14.94 | 6ab8bb6930f57dbeaea63688 | 197448 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414adb | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 79 | 23년 6월 고1 영어모의고사 34번 | 제목 | 18.82 | 18.85 | 6ab8bb6930f57dbeaea63689 | 197449 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414adc | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 80 | 23년 6월 고1 영어모의고사 34번 | 일치 | 24.68 | 24.71 | 6ab8bb6930f57dbeaea6368a | 197450 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414add | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 81 | 23년 6월 고1 영어모의고사 34번 | 불일치 | 8.11 | 8.21 | 6ab8bb6930f57dbeaea6368b | 197451 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ade | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 82 | 23년 6월 고1 영어모의고사 34번 | 빈칸 | 38.56 | 38.59 | 6ab8bb6930f57dbeaea6368c | 197452 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414adf | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 83 | 23년 6월 고1 영어모의고사 34번 | 요약 | 26.61 | 26.64 | 6ab8bb6930f57dbeaea6368d | 197453 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ae0 | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 84 | 23년 6월 고1 영어모의고사 34번 | 순서 | 3.16 | 3.19 | 6ab8bb6930f57dbeaea6368e | 197454 | 대기 / 초안 생성됨 | 6ab8b58bf4e8fd7445414ae1 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 85 | 23년 6월 고1 영어모의고사 34번 | 삽입 | 4.33 | 4.37 | 6ab8bb6a30f57dbeaea6368f | 197455 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae2 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 86 | 23년 6월 고1 영어모의고사 34번 | 무관한문장 | 9.39 | 9.42 | 6ab8bb6a30f57dbeaea63690 | 197456 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae3 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 87 | 23년 6월 고1 영어모의고사 34번 | 어휘 | 3.86 | 3.89 | 6ab8bb6a30f57dbeaea63691 | 197457 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae4 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 88 | 23년 6월 고1 영어모의고사 34번 | 어법 | 7.64 | 7.67 | 6ab8bb6a30f57dbeaea63692 | 197458 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae5 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 89 | 23년 6월 고1 영어모의고사 35번 | 주제 | 10.20 | 10.23 | 6ab8bb6a30f57dbeaea63693 | 197459 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae6 | mlx-community/Qwen2.5-7B-Instruct-4bit | topic | mlx-community/Qwen3.6-35B-A3B-4bit |
| 90 | 23년 6월 고1 영어모의고사 35번 | 제목 | 17.35 | 17.39 | 6ab8bb6a30f57dbeaea63694 | 197460 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae7 | mlx-community/Qwen2.5-7B-Instruct-4bit | title | mlx-community/Qwen3.6-35B-A3B-4bit |
| 91 | 23년 6월 고1 영어모의고사 35번 | 일치 | 13.78 | 13.81 | 6ab8bb6a30f57dbeaea63695 | 197461 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae8 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 92 | 23년 6월 고1 영어모의고사 35번 | 불일치 | 13.67 | 13.70 | 6ab8bb6a30f57dbeaea63696 | 197462 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414ae9 | mlx-community/Qwen2.5-7B-Instruct-4bit | fact | mlx-community/Qwen3.6-35B-A3B-4bit |
| 93 | 23년 6월 고1 영어모의고사 35번 | 빈칸 | 10.32 | 10.35 | 6ab8bb6a30f57dbeaea63697 | 197463 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414aea | mlx-community/Qwen2.5-7B-Instruct-4bit | blank | mlx-community/Qwen3.6-35B-A3B-4bit |
| 94 | 23년 6월 고1 영어모의고사 35번 | 요약 | 33.91 | 33.94 | 6ab8bb6a30f57dbeaea63698 | 197464 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414aeb | mlx-community/Qwen2.5-7B-Instruct-4bit | summary | mlx-community/Qwen3.6-35B-A3B-4bit |
| 95 | 23년 6월 고1 영어모의고사 35번 | 순서 | 8.51 | 8.54 | 6ab8bb6a30f57dbeaea63699 | 197465 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414aec | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 96 | 23년 6월 고1 영어모의고사 35번 | 삽입 | 2.33 | 2.36 | 6ab8bb6a30f57dbeaea6369a | 197466 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414aed | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 97 | 23년 6월 고1 영어모의고사 35번 | 무관한문장 | 4.31 | 4.34 | 6ab8bb6b30f57dbeaea6369b | 197467 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414aee | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 98 | 23년 6월 고1 영어모의고사 35번 | 어휘 | 6.45 | 6.48 | 6ab8bb6b30f57dbeaea6369c | 197468 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414aef | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |
| 99 | 23년 6월 고1 영어모의고사 35번 | 어법 | 3.95 | 3.98 | 6ab8bb6b30f57dbeaea6369d | 197469 | 대기 / 초안 생성됨 | 6ab8b58cf4e8fd7445414af0 | mlx-community/Qwen2.5-7B-Instruct-4bit | 규칙 생성 (LoRA 없음) | mlx-community/Qwen3.6-35B-A3B-4bit |

## 실패·미저장 출처

| 출처 | 유형 | 상태 | 작업ID |
|---|---|---|---|
| 23년 6월 고1 영어모의고사 24번 | 요약 | 생성 실패 / 미저장 | 6ab8b589f4e8fd7445414a9f |
| 23년 6월 고1 영어모의고사 33번 | 삽입 | 생성 실패 / 미저장 | 6ab8b58bf4e8fd7445414ad7 |
