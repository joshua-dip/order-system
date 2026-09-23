/**
 * 로컬 제목 LoRA 추론 → 검증 → (옵션) 저장. Anthropic/Claude 호출 없음.
 *
 *   npm run cc:title-local -- --backend cuda --pipeline --passage-id <ObjectId> [--save]
 *   npm run cc:title-local -- --passage-file p.txt --textbook "..." --source "..."
 *
 * 구현은 scripts/_local-variant-runner.ts(주제·제목·주장 공용). cc:local-variant -- --type 제목 과 같다.
 */
import { runLocalVariantCliMain } from './_local-variant-runner';

runLocalVariantCliMain('제목');
