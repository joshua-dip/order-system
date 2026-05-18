# 영어 서·논술형 평가 PDF 생성 키트

Korean English Writing-Type (서·논술형 배열) Exam PDF Generator.

## 📁 파일 구성

```
exam_kit/
├── styles.css              # 디자인 시스템 (CSS)
├── exam_template.html      # Jinja2 HTML 템플릿
├── render.py               # PDF 렌더러 (WeasyPrint)
├── example_data.json       # 입력 데이터 스키마 예시 (모의 3회)
├── generation_prompt.md    # Claude API 자동 생성 프롬프트
└── README.md               # 이 문서
```

## ⚙️ 필수 환경

### 시스템 패키지
```bash
# Ubuntu/Debian
sudo apt install fonts-noto-cjk fonts-noto-cjk-extra libpango-1.0-0 libharfbuzz0b libpangoft2-1.0-0

# macOS
brew install pango libffi
brew install --cask font-noto-sans-cjk-kr font-noto-serif-cjk-kr
```

### Python 패키지
```bash
pip install weasyprint jinja2
# (선택) Claude API 사용 시
pip install anthropic
```

## 🚀 사용법

### 방법 1: JSON 파일로 직접 렌더링

```bash
python render.py example_data.json output.pdf
```

### 방법 2: Python에서 딕셔너리로 직접 렌더링

```python
from render import render_from_dict

data = {
    "meta": {...},
    "question_set": {...},
    "passage": "...",
    "questions": [...]
}

render_from_dict(data, "output.pdf")
```

### 방법 3: Claude API로 자동 생성 + 렌더링 (완전 자동화)

```python
import anthropic
import json
from render import render_from_dict

# 1. 프롬프트 로드
with open('generation_prompt.md', 'r', encoding='utf-8') as f:
    system_prompt = f.read()

# 2. Claude에게 지문 전달
passage = """
Many things happen in our brains that we are unaware of.
... (지문 전문)
"""

client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-opus-4-7",
    max_tokens=8000,
    system=system_prompt,
    messages=[{
        "role": "user",
        "content": f"지문:\n{passage}\n\n난이도: 고난도\n문항 번호: 서·논술형 5"
    }]
)

# 3. JSON 파싱 (Claude가 순수 JSON만 반환하도록 설계됨)
raw_text = response.content[0].text.strip()
# 만약 코드 펜스로 감싸져 있으면 제거
if raw_text.startswith("```"):
    raw_text = raw_text.split("\n", 1)[1].rsplit("\n", 1)[0]
    raw_text = raw_text.replace("```json\n", "").replace("```", "")

data = json.loads(raw_text)

# 4. PDF 렌더링
render_from_dict(data, "generated_exam.pdf")
```

## 📐 데이터 스키마

`example_data.json`이 완전한 참조 예시입니다. 핵심 구조:

```json
{
  "meta": {
    "title": "영어 서·논술형 평가",
    "difficulty": "고난도",          // 또는 null
    "subtitle": "...",
    "answer_subtitle": "...",
    "info": [{"label": "...", "value": "..."}]
  },
  "question_set": {
    "tag": "서·논술형 5",
    "instruction": "다음 글을 읽고 질문에 답하시오."
  },
  "passage": "영어 원문 + <span class=\"kr\">한국어 번역</span> 블록",
  "questions": [
    {
      "id": "5-1",
      "points": 4,
      "prompt": "밑줄 친 (A)를 ...",
      "conditions": ["조건1", "조건2", ...],
      "bogi": "chunk1 / chunk2 / ...",
      "answer_lines": 2,
      "answer": {
        "text": "모범답안",
        "structure_analysis": [...],    // 선택 (고난도에만)
        "grammar_points": [...],
        "word_count": {"total": N, "words": [...], "note": null},
        "intent_title": "...",
        "intent_content": "..."
      }
    }
  ]
}
```

### 필수 vs 선택 필드

**필수**:
- `meta.title`, `meta.subtitle`, `meta.info`
- `question_set.tag`, `question_set.instruction`
- `passage`
- `questions[].id`, `.points`, `.prompt`, `.conditions`, `.bogi`, `.answer.text`, `.answer.grammar_points`, `.answer.word_count`, `.answer.intent_content`

**선택**:
- `meta.difficulty` — 없으면 배지 미표시
- `meta.answer_subtitle` — 없으면 빈 부제
- `questions[].answer_lines` — 기본값 2
- `questions[].answer.structure_analysis` — 고난도에만 권장
- `questions[].answer.intent_title` — 기본값 "출제 의도 · 감점 포인트"
- `word_count.note` — null 가능

## 🎨 커스터마이징 가이드

### 난이도 배지 색상 변경

`styles.css`의 `.diff-badge`:

```css
.diff-badge {
  background: #b91c1c;   /* 고난도: 빨강 */
  /* 중난도: background: #d97706; */
  /* 쉬움: background: #16a34a; */
}
```

### 학원 로고 추가

`exam_template.html`의 `<div class="header">` 위에 삽입:

```html
<div style="position: absolute; top: 10mm; right: 14mm;">
  <img src="logo.png" style="height: 12mm;">
</div>
```

### 답안 줄 개수 조정

JSON의 `questions[].answer_lines`를 조정:
- `1`: 짧은 답안 (15단어 이하)
- `2`: 기본 (16~24단어) ← 권장
- `3`: 긴 답안 (25단어 이상)

### 여백 조정

`styles.css`의 `@page`:

```css
@page {
  size: A4;
  margin: 13mm 14mm 12mm 14mm;  /* 상 우 하 좌 */
}
```

## 🔍 문제 해결

### "한글이 사각형으로 나옴"
Noto CJK 폰트가 설치되지 않았습니다. 위의 시스템 패키지 설치 명령어 실행.

### "2페이지로 안 맞음 (3페이지로 늘어남)"
조건 항목이 너무 많거나 해설 테이블 행 수가 과도. 다음을 시도:
1. `answer_lines`를 3→2 또는 2→1로 줄이기
2. `grammar_points` 행 수를 6→5로 줄이기
3. `styles.css`의 `@page margin` 값을 12mm → 10mm로 축소

### "WeasyPrint 설치 오류"
Ubuntu 24.04는 `libpango-1.0-0` 대신 `libpango-1.0-0t64` 사용:
```bash
sudo apt install libpango-1.0-0t64 libharfbuzz0b libpangoft2-1.0-0t64
```

## 📝 워크플로우 예시

### 시나리오: 모의고사 1회~5회 일괄 제작

```python
import json
from pathlib import Path
from render import render_from_dict
import anthropic

# 지문 5개 준비
passages = [
    ("mock_1", "passage text 1..."),
    ("mock_2", "passage text 2..."),
    # ...
]

with open('generation_prompt.md') as f:
    system_prompt = f.read()

client = anthropic.Anthropic()

for exam_id, passage in passages:
    # 1. Claude로 JSON 생성
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=8000,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": f"지문:\n{passage}\n\n난이도: 고난도\n문항 번호: 서·논술형 1"
        }]
    )
    data = json.loads(response.content[0].text.strip())
    
    # 2. 중간 JSON 저장 (검토용)
    Path(f"{exam_id}_data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )
    
    # 3. PDF 렌더링
    render_from_dict(data, f"{exam_id}.pdf")
    print(f"✓ {exam_id}.pdf 생성 완료")
```

## 📄 라이선스

Lyceum English Academy / Payperic Books 내부 사용 목적.
