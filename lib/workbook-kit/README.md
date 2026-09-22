# workbook-kit

BW/MW 주문용 **빈칸쓰기 · 낱말배열 · 어법(G/H)** 을 관리자에서 PDF로 뽑는 모듈.

## 원본

- Dropbox `업무자동화/워크북/` 파이썬이 클라우드-only(0B)라, payperic 샘플 PDF/XLSX
  (`워크북_빈칸쓰기/{ADJ,KEYWORD,NOUN,PREP,VERB}_*`, `워크북_낱말배열`)와
  `grammar-ref/워크북_어법*.py` · 기존 `lib/grammar-workbook-*` 를 기준으로 복원·이식.
- Claude API 호출 없음. 어법은 저장된 `grammar_workbooks` 만 사용.

## 유형

| id | 설명 |
|----|------|
| `blank_adj` … `blank_verb` | POS/규칙으로 `(n) __________` 마스킹 |
| `word_arrange` | 문장별 KO + 셔플 EN 단어(`/` 구분) |
| `grammar_either_or` / `grammar_correction` | 기존 어법공략 G/H PDF |
