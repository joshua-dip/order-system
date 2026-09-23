/**
 * 로컬 LoRA 변형문제 CLI — 주제·제목·주장 공용 진입점. Anthropic/Claude 호출 없음.
 *
 *   npm run cc:local-variant -- --type 주제 --passage-id <ObjectId>
 *   npm run cc:local-variant -- --type 제목 --backend cuda --pipeline --passage-id <ObjectId> --save
 *   npm run cc:local-variant -- --type claim --passage-file p.txt --textbook "교재" --source "출처"
 *
 * 구현은 scripts/_local-variant-runner.ts. 관리자 화면·배포 사이트는 GPU PC 워커(ml/worker)를 쓴다.
 */
import { runLocalVariantCliMain } from './_local-variant-runner';

runLocalVariantCliMain(null);
