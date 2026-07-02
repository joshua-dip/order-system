/** 원문데이터 전수 검색 — 'upcycling' 등 유니크 토큰이 어느 컬렉션에든 있는지. read-only. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliEnv } from './_cli-env';
import { getDb } from '@/lib/mongodb';

loadCliEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const cli = process.argv.slice(2).filter(Boolean);
const terms = cli.length ? cli : ['upcycling', 'wooden pallets', 'repurposing glass jars'];
function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function main() {
  const db = await getDb('gomijoshua');
  // 텍스트를 담을 만한 컬렉션들
  const cols = ['passages', 'generated_questions', 'narrative_questions', 'essay_exams', 'essay_step_workbooks', 'generated_workbooks', 'block_workbooks', 'grammar_workbooks', 'vip_studio', 'passage_analyses'];

  for (const term of terms) {
    const rx = { $regex: esc(term), $options: 'i' };
    console.log(`\n===== "${term}" =====`);
    for (const cn of cols) {
      try {
        const col = db.collection(cn);
        // passages: content 하위(문자열+배열) 전부
        const or = cn === 'passages'
          ? [{ 'content.original': rx }, { 'content.mixed': rx }, { 'content.translation': rx }, { 'content.sentences_en': rx }]
          : [{ 'question_data.Paragraph': rx }, { 'question_data.Question': rx }, { passageText: rx }, { originalText: rx }, { 'data.passage': rx }, { text: rx }, { html: rx }, { content: rx }, { title: rx }];
        const n = await col.countDocuments({ $or: or });
        if (n > 0) {
          console.log(`  ${cn}: ${n}건`);
          const one = await col.findOne({ $or: or }, { projection: { textbook: 1, source: 1, source_key: 1, title: 1, examTitle: 1 } });
          console.log(`     예) ${JSON.stringify({ id: String(one?._id), textbook: one?.textbook, source: one?.source ?? one?.source_key, title: one?.title ?? one?.examTitle })}`);
        }
      } catch (e) { void e; /* 컬렉션 없음/필드 없음 무시 */ }
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e instanceof Error ? e.message : e); process.exit(1); });
