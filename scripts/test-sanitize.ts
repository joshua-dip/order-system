/**
 * 일회성 테스트: 샘플 문서 한 건만 sanitize 해서 결과 확인 (DB 변경 X)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { auditContent } from '@/lib/essay-exam-content-audit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local') });

const META_BARE = new Set(['to','be','ing','pp','s','v','o','c','m']);
const META_COMPOUND_RE = /(to부정사|be동사|-ing형|p\.p\.|S\/V\/O\/C\/M|SVOC|SVO|SV\b)/g;
const FUNCTION_WORDS = new Set(['a','an','the','is','are','was','were','am','been','being',"isn't","aren't","wasn't","weren't",'do','does','did',"don't","doesn't","didn't",'have','has','had',"haven't","hasn't","hadn't",'can','could','will','would','shall','should','may','might','must',"can't","couldn't","won't","wouldn't","shouldn't",'in','on','at','of','by','for','with','from','into','onto','upon','about','under','over','through','against','between','among','across','around','after','before','during','until','while','within','without','as','out','up','down','off','and','or','but','so','nor','yet','if','then','because','i','me','my','mine','we','us','our','ours','you','your','yours','he','him','his','she','her','hers','it','its','they','them','their','theirs','this','that','these','those','such','one','ones','who','whom','whose','which','what','when','where','why','how','not','no','never','none','most','very','too','much','more','less','few','many','than','else','also','still','just']);

const BOILERPLATE_PATTERNS = [
  /본문에 제시한 우리말 해석과 의미가 일치할 것/,
  /올바른 어법을 사용하여 완전한 문장을 작성할 것/,
  /\d+\s*개의?\s*단어로 답안을 작성할 것/,
  /주어진 한국어 해석에 부합하도록 영어 문장을 ['"`]작성['"`]할 것/,
  /아래 보기의 단어를 모두 사용하여 올바른 문장을 ['"`]작성['"`]할 것/,
  /아래 보기의 단어\(구\)들을 모두 사용하여 올바른 순서로 ['"`]배열['"`]할 것/,
];
function isBoilerplate(s: string): boolean { return BOILERPLATE_PATTERNS.some(re => re.test(s)); }

function maskMetaCompounds(s: string) {
  const matches: string[] = [];
  const masked = s.replace(META_COMPOUND_RE, m => { matches.push(m); return `${matches.length - 1}`; });
  return { masked, restore: (x: string) => x.replace(/(\d+)/g, (_, i) => matches[Number(i)] ?? '') };
}

function stripHtml(s: string): string {
  let r = s.replace(/<code>[\s\S]*?<\/code>/gi, '');
  r = r.replace(/<\/?(?:b|strong|em|i|u|small|sub|sup|span|font|mark)(?:\s[^>]*)?>/gi, '');
  r = r.replace(/<br\s*\/?>/gi, ' ');
  return r;
}
function stripEnglishParens(s: string): string {
  let prev: string; let cur = s;
  do { prev = cur; cur = cur.replace(/\(([^()]*)\)/g, (m, inner) => {
    const { masked } = maskMetaCompounds(inner);
    const tokens = masked.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    const suspect = tokens.filter(t => !META_BARE.has(t.toLowerCase()) && !/^__META\d+__$/.test(t));
    if (suspect.length > 0) return '';
    return m;
  }); } while (cur !== prev);
  return cur;
}
function cleanBrackets(s: string): string {
  const cleanInner = (inner: string): string => {
    const { masked, restore } = maskMetaCompounds(inner);
    let r = masked.replace(/[A-Za-z]+(?:-[A-Za-z]+)+/g, '');
    r = r.replace(/[A-Za-z][A-Za-z']*/g, (tok) => {
      if (/^__META\d+__$/.test(tok)) return tok;
      const lo = tok.toLowerCase();
      if (META_BARE.has(lo)) return tok;
      return '';
    });
    r = restore(r);
    r = r.replace(/\s*\+\s*\+\s*/g, ' + ');
    r = r.replace(/^\s*\+\s*/, '').replace(/\s*\+\s*$/, '');
    return r.replace(/\s+/g, ' ').trim();
  };
  let r = s.replace(/「([^」]*)」/g, (_m, inner) => `「${cleanInner(inner)}」`);
  r = r.replace(/\[([^\]]*)\]/g, (_m, inner) => `[${cleanInner(inner)}]`);
  return r;
}
function stripEnglishOutsideBrackets(s: string): string {
  const segments: Array<{ type: 'protect' | 'open'; text: string }> = [];
  let i = 0;
  while (i < s.length) {
    const nextOpen = s.slice(i).search(/[「\[]/);
    if (nextOpen < 0) { segments.push({ type: 'open', text: s.slice(i) }); break; }
    if (nextOpen > 0) segments.push({ type: 'open', text: s.slice(i, i + nextOpen) });
    const openIdx = i + nextOpen;
    const opener = s[openIdx];
    const closer = opener === '「' ? '」' : ']';
    const closeRel = s.indexOf(closer, openIdx + 1);
    if (closeRel < 0) { segments.push({ type: 'open', text: s.slice(openIdx) }); break; }
    segments.push({ type: 'protect', text: s.slice(openIdx, closeRel + 1) });
    i = closeRel + 1;
  }
  return segments.map((seg) => {
    if (seg.type === 'protect') return seg.text;
    const { masked, restore } = maskMetaCompounds(seg.text);
    let r = masked.replace(/[A-Za-z]+(?:-[A-Za-z]+)+/g, '');
    r = r.replace(/[A-Za-z][A-Za-z']*/g, (tok) => {
      if (/^__META\d+__$/.test(tok)) return tok;
      const lo = tok.toLowerCase();
      if (META_BARE.has(lo) || FUNCTION_WORDS.has(lo)) return tok;
      return '';
    });
    return restore(r);
  }).join('');
}
function stripAnswerHyphenCompounds(s: string, answerText: string): string {
  const compounds = [...answerText.matchAll(/[A-Za-z]+(?:-[A-Za-z]+)+/g)].map(m => m[0]);
  let r = s;
  for (const c of compounds) r = r.split(c).join('');
  return r;
}
function reattachKoreanParticles(s: string): string {
  const PARTICLES = ['으로서','으로써','으로부터','로부터','으로','로서','로써','에서','에게서','에게','와','과','이며','이고','이지만','이나','이라','이라도','은','는','이','가','을','를','의','로','에','도','만','조차','마저','보다','만큼'];
  let r = s;
  PARTICLES.sort((a, b) => b.length - a.length);
  for (const p of PARTICLES) {
    const re = new RegExp(`([\\uAC00-\\uD7AF])\\s+(${p})(?=[\\s,.「\\[]|$)`, 'g');
    r = r.replace(re, '$1$2');
  }
  return r;
}
function finalCleanup(s: string): string {
  let r = s;
  for (let i = 0; i < 3; i++) {
    const b = r;
    r = r.replace(/\(\s*\)/g, '').replace(/「\s*」/g, '').replace(/\[\s*\]/g, '');
    if (r === b) break;
  }
  r = r.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1');
  r = r.replace(/「\s+/g, '「').replace(/\s+」/g, '」');
  r = r.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  r = r.replace(/\s\+\s\+\s/g, ' + ');
  return r.trim();
}
function sanitizeCondition(cond: string, answerText: string): string {
  if (isBoilerplate(cond)) return cond;
  let s = cond;
  s = stripHtml(s);
  s = stripAnswerHyphenCompounds(s, answerText);
  s = stripEnglishParens(s);
  s = cleanBrackets(s);
  s = stripEnglishOutsideBrackets(s);
  s = reattachKoreanParticles(s);
  s = finalCleanup(s);
  return s;
}

async function main() {
  const db = await getDb('gomijoshua');
  const id = process.argv[2] || '6a02f8ba39cf925ad58600d1';
  const doc = await db.collection('essay_exams').findOne({ _id: new ObjectId(id) });
  if (!doc) { console.log('not found'); process.exit(1); }
  const data: any = doc.data;
  console.log('=== examId', id, 'difficulty', doc.difficulty, '===');
  for (const q of data.questions || []) {
    console.log('\nQ', q.id);
    console.log('  answer.text:', q.answer?.text);
    const newConds = (q.conditions || []).map((c: string) => sanitizeCondition(c, q.answer?.text || ''));
    (q.conditions || []).forEach((c: string, i: number) => {
      if (c !== newConds[i]) {
        console.log(`  [${i}] BEFORE: ${c}`);
        console.log(`       AFTER:  ${newConds[i]}`);
      } else {
        console.log(`  [${i}] (unchanged) ${c}`);
      }
    });
    q.conditions = newConds;
  }
  /* audit on patched */
  const after = auditContent({ ...doc, _id: id, data } as any);
  const errs = after.findings.filter((f: any) => f.level === 'error');
  console.log(`\n=== audit on patched: errors=${errs.length}, total findings=${after.findings.length} ===`);
  for (const f of errs.slice(0, 20)) console.log(' -', f.code, f.message);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
