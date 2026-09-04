# 요지 파악·영작형 (2문항 세트 · 4난도) 생성 규칙 — Pro 전용

> examType **`일반요지요약형`** 의 신형 구조. 한 지문 = **4난도 × 2문항 세트**.
> API 키 호출 금지 — 오직 `npm run cc:essay` CLI 로만 저장. 전부 `/Users/goshua/next-order` 에서 실행(worktree 금지).

## 먼저 읽기
1. `assets/exam_kit/generation_prompt.md` — 공통 ExamData 스키마(meta/question_set/passage/questions).
2. `lib/essay-generator-difficulty-appendix.ts` — `ESSAY_MAIN_IDEA_APPENDIX_TEXT`(2문항·4난도 규칙) 통독.

## 한 지문 처리 순서
1. `npm run cc:essay -- passage --id <passage_id>` 로 original/translation/sentences 확보.
2. 글의 **요지 하나**를 파악한다. 그 요지를 **서로 다른 4개의 영어 문장**으로 표현한다 — 구조를 난도마다 다르게:
   - 예) 5형식 `S make O C` / 이유절 `Unlike …, S is … because …` / what-분열문 `What … is …` / 대조삽입+수동 `S, unlike …, is … and driven by …`.
   - 각 문장 **10~20단어**. 같은 문장을 두 난도에 재사용 금지.
3. 4난도 각각 **2문항 세트** JSON 파일 작성. 파일명 `.essay-drafts/tbBST_<slug>_<diff>.json` (`<slug>`=sourceKey 영숫자·한글 외 `_` 치환, `<diff>`=basic/mid/hard/max).
   최상위 필드: `passageId`, `textbook`="Booster 유형독해(2022)", `sourceKey`, `difficulty`(기본난도/중난도/고난도/최고난도), `folder`="Booster 유형독해(2022)", `examSubtitle`=sourceKey, `data`.
   `data.meta`: `title`, `difficulty`(난도), **`examType`="일반요지요약형"**, `subtitle`, `answer_subtitle`, `info`(배점 value "10점 (4점 + 6점)").
   `data.question_set`: `{tag:"서·논술형 1", instruction:"다음 글을 읽고 물음에 답하시오."}`.
   `data.passage`: 지문 원문 **그대로**(배열형 (A)/(B) 마커·`<span class="kr">` 없음).
   `data.questions`: **정확히 2개**:
   - **Q1 (요지 파악)**: `id:"1"`, `role:"comprehend"`, `points:4`, `bogi:""`,
     `prompt` 예 "이 글의 요지를 한 줄의 우리말로 쓰시오."(난도별 살짝 변주),
     `conditions` 3개(맥락 근거·표면 소재 아닌 핵심 대조·간결),
     `answer.text` = **우리말 요지 한 문장**(난도마다 표현 다르게, 영어 토큰 금지),
     `answer.word_count` = 우리말 **어절** 기준(total=어절 수, words=공백 분리 어절 배열),
     `answer.grammar_points` 2개(요지 판단 근거·대조 구조), `answer.intent_title`/`intent_content`.
   - **Q2 (요지 영작)**: `id:"2"`, `role:"compose"`, `points:6`,
     `answer.text` = 그 난도의 **영어 요지 문장**, `answer.word_count` 영어(하이픈·숫자·축약 1단어),
     `answer.grammar_points` 3~4개(문장 구조 설명), `answer.intent_content`.
     **난도별 bogi/prompt/conditions**:
     - **기본**: bogi = 정답 문장의 뼈대 내용어(관사·전치사·접속사 제외)를 **정답 순서 그대로** ` / ` 나열. prompt "…<보기>에 주어진 단어를 모두 한 번씩 순서대로 사용하여 10단어 이상 20단어 이내…(어형변화 금지, 철자 오류 오답, 부분 점수)". conditions 4개(순서대로·어형변화 금지·10~20단어·철자).
     - **중**: bogi = 같은 뼈대 내용어를 **임의 순서로 섞어** 나열. prompt "…순서는 문맥에 맞게 바로잡아…". conditions 4개(모두 한 번씩·어형변화 금지·10~20단어·철자).
     - **고**: bogi = 핵심 내용어 **원형(lemma)** 4~9개를 **알파벳순** 나열. prompt "…모두 활용하여(어형은 문맥에 맞게 바꿔)…". conditions 3~5개는 **문법 카테고리(한글)만** — 굴절형·함수어·2-gram 어순 노출 금지, 메타용어(to부정사·be동사·p.p.·SVOC 등)만 영어 허용.
     - **최고**: bogi = **우리말 요지문 한 줄만**(영어 토큰 0, Q1 답과는 표현 다르게). prompt "…아래 <우리말 요지>에 맞게…". conditions 3~6개 문법 카테고리(한글)만 + "주어진 우리말 요지에 부합하도록 … '작성'할 것". 정답 영어 단어 인용 금지.
4. 만든 4파일 각각 dry-run: `npm run cc:essay -- save --json <파일> --dry-run` → `validation.valid:true`(에러 있으면 고쳐 재검증).
5. 4파일 한 번에 저장(지문당 **save-all 1회만**): `npm run cc:essay -- save-all <basic> <mid> <hard> <max>`. `results[*].ok` 모두 true 확인. 하나라도 false 면 즉시 정지( `--force` 금지, validation.errors 보고).
6. 리스트의 다음 지문으로. 배정된 지문을 모두 처리하면 종료.

## 검증 핵심 (dry-run 통과 조건)
- Q2: answer.text 토큰수 == word_count.total == words.length. bogi(기본)=정답 순서 부분집합, (중)=순서 무관 부분집합, (고)=lemma 알파벳순, (최고)=한국어. 조건/프롬프트의 "10단어 이상 20단어 이내" 범위와 total 일치.
- Q1: answer.text 는 우리말(한글 포함). word_count.words.length == total.
- questions 길이 2, examType 일반요지요약형.

## 금지
- ScheduleWakeup·`--force`·`/api/admin/essay-generator/generate` 등 API·for/while·`$VAR`/`${...}`·xargs.

## 최종 보고
- chapter / 저장한 지문별 sourceKey + examId 4개(기본·중·고·최고) / 실패·건너뜀 상세.
