/**
 * 로컬 주제 LoRA 추론 → 검증 → (옵션) 저장. Anthropic/Claude 호출 없음.
 *
 *   Mac MLX:      npm run cc:topic-local -- --passage-id <ObjectId>
 *   Windows CUDA: npm run cc:topic-local -- --backend cuda --passage-id <ObjectId>   (또는 TOPIC_BACKEND=cuda)
 *   Pipeline:     npm run cc:topic-local -- --backend cuda --pipeline --passage-id <ObjectId> [--save]
 *   파일 지문:    npm run cc:topic-local -- --passage-file p.txt --textbook "..." --source "..."
 *
 * 구현은 scripts/_local-variant-runner.ts(주제·제목·주장 공용). cc:local-variant -- --type 주제 와 같다.
 */
import { runLocalVariantCliMain } from './_local-variant-runner';

runLocalVariantCliMain('주제');
