/**
 * LoRA 학습 데이터 export 공용 — 고정 평가 세트(ml/eval/sets/*.json)의 교재 지문을 학습에서 뺀다.
 *
 * 평가 지문(26년 9월 고1)이 학습 데이터에도 들어 있어(빈칸 20번 지문 3문항 등) 시험지 점수가 일부
 * 「외워서 푼」 몫이었다(노트 21과). 교재 단위로 뺀다 — 같은 지문의 다른 유형 문항도 외울 단서가 된다.
 *
 *   const evalSet = createEvalSetFilter(PROJECT_ROOT);
 *   paragraph = evalSet.exclude(passageId, p?.textbook) ? '' : getPassageTextForVariantCompare(p?.content);
 *   if (evalSet.skip(passageId)) continue;   // 캐시된 지문도 매번 확인
 *   evalSet.report();                         // 끝에 몇 문항 뺐는지 stderr 로
 */
import fs from 'node:fs';
import path from 'node:path';

export function createEvalSetFilter(projectRoot: string) {
  const dir = path.join(projectRoot, 'ml/eval/sets');
  const textbooks = new Set<string>(
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => String(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).textbook ?? ''))
          .filter(Boolean)
      : []
  );
  const passages = new Set<string>();
  let count = 0;
  return {
    textbooks,
    /** 지문을 처음 읽을 때 — 평가 교재면 기억해 두고 true */
    exclude(passageId: string, textbook: unknown): boolean {
      if (!textbooks.has(String(textbook ?? ''))) return false;
      passages.add(passageId);
      return true;
    },
    /** 문항마다 — 평가 교재 지문이면 세고 true */
    skip(passageId: string): boolean {
      if (!passages.has(passageId)) return false;
      count++;
      return true;
    },
    get count() {
      return count;
    },
    report(): void {
      console.error(`평가 세트 교재 제외: ${count}문항 (${[...textbooks].join(', ') || '세트 없음'})`);
    },
  };
}
