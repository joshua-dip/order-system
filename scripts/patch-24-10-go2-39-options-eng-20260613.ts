/**
 * 24년 10월 고2 영어모의고사 39번 (Hobbes) — 한글 선택지 28건 영어 재작성 (2026-06-13).
 * MV-20260612-001 주문 검수에서 발견. 한 지문에 일치·불일치·제목·주제 한글 보기 28건.
 * 한글 보기가 여러 문항에서 재사용되므로 KO→EN 매핑 사전으로 일관 치환.
 * 정답 슬롯·해설 유지. 매핑 누락 보기가 있으면 그 문항 스킵+보고.
 * 어법 2건은 구조 손상(보기에 밑줄 표현 없음)이라 별도 처리.
 *
 * 사용: npx tsx scripts/patch-24-10-go2-39-options-eng-20260613.ts [--apply]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { getDb } from '@/lib/mongodb';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ path: path.join(PROJECT_ROOT, '.env') });
config({ path: path.join(PROJECT_ROOT, '.env.local') });

const APPLY = process.argv.includes('--apply');
const SOURCE = '24년 10월 고2 영어모의고사 39번';
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const HANGUL_RE = /[가-힣]/;

/** 보기에서 번호·끝 마침표·공백 제거해 매핑 키로 정규화 */
function normKey(seg: string): string {
  return seg.replace(/^[①②③④⑤]\s*/, '').replace(/[.\s]+$/u, '').trim();
}

const KO2EN: Record<string, string> = {
  // 일치·불일치 (문장)
  '사회는 상호 애정이 아닌 공유된 두려움에서 형성된다고 홉스는 주장합니다':
    'Hobbes argues that society is formed from shared fear, not from mutual affection.',
  '홉스는 인간이 이기적인 본능에 따라 이성적으로 행동한다고 믿었습니다':
    'Hobbes believed that humans act rationally according to their selfish instinct.',
  '홉스는 인간은 자연에서 생존하려는 본능에도 불구하고 도덕적으로 행동한다고 말합니다':
    'Hobbes says that humans act morally in spite of their instinct to survive in nature.',
  '주권적 권력은 자연의 상태와 다른 도덕적 자유를 시작합니다':
    'Sovereign power initiates a moral liberty different from the state of nature.',
  '자연의 상태에서 삶은 지저분하고 잔인한 것으로 묘사됩니다':
    'Life in the state of nature is described as nasty and brutish.',
  '홉스는 통제 없는 삶은 전쟁 상태를 초래한다고 주장합니다':
    'Hobbes argues that life without control leads to a state of war.',
  '홉스는 자연 상태에서의 인간의 삶을 평화롭고 긴 삶으로 묘사합니다':
    'Hobbes describes human life in the state of nature as peaceful and long.',
  '홉스에 따르면 강력한 국가는 인간의 반사회적 본능을 억제합니다':
    "According to Hobbes, a strong state restrains humans' antisocial instincts.",
  '홉스에 따르면 도덕과 자유는 주권 국가에 의존하지 않습니다':
    'According to Hobbes, morality and liberty do not depend on the sovereign state.',
  '홉스는 도덕은 국가의 출현으로만 발생한다고 주장합니다':
    'Hobbes argues that morality arises only with the emergence of the state.',
  '홉스는 인간을 자연 상태에서 정치적이고 사회적인 존재로 간주했습니다':
    'Hobbes regarded humans as political and social beings in the state of nature.',
  '홉스는 자연의 상태가 조화롭고 우호적인 존재라고 믿었습니다':
    'Hobbes believed that the state of nature was a harmonious and friendly existence.',
  '홉스에 따르면 사회는 사람들을 하나로 모으는 자연스러운 현상입니다':
    'According to Hobbes, society is a natural phenomenon that brings people together.',
  '홉스는 상호 사랑이 자연 상태의 사람들을 하나로 묶는다고 주장합니다':
    'Hobbes argues that mutual love binds together people in the state of nature.',
  // 제목
  '홉스: 자연 상태는 도덕적, 정치적 구조가 부족하다':
    'Hobbes: The State of Nature Lacks Moral and Political Structure',
  '도덕적 성장을 위한 이상적인 조건을 제공하는 자연의 상태':
    'The State of Nature Offering Ideal Conditions for Moral Growth',
  '인간 사회는 협력을 통해 자연스럽게 형성된다고 홉스는 주장합니다':
    'Hobbes Argues Human Society Forms Naturally Through Cooperation',
  '홉스는 공포가 사람들을 분열시켜 사회 통합을 방해한다고 주장했습니다':
    'Hobbes Argued Fear Divides People and Hinders Social Unity',
  '홉스는 자연의 상태는 평화롭고 번영하는 공동체라고 말합니다':
    'Hobbes Says the State of Nature Is a Peaceful, Prosperous Community',
  '홉스는 장수와 행복을 가진 자연의 상태를 설명합니다':
    'Hobbes Describes a State of Nature with Long Life and Happiness',
  '홉스는 자연의 상태를 조화롭고 즐거운 것으로 묘사합니다':
    'Hobbes Describes the State of Nature as Harmonious and Pleasant',
  '두려움은 사회에서 인간을 하나로 묶는다고 철학자 홉스는 주장합니다':
    'Philosopher Hobbes Argues Fear Binds Humans Together in Society',
  '홉스는 사회적 존재가 야생 상태에서 본능적으로 번성한다고 믿었습니다':
    'Hobbes Believed Social Beings Instinctively Thrive in the Wild State',
  '권위 없는 고독하고 잔인한 삶, 홉스가 이론화하다':
    'A Solitary, Brutish Life Without Authority, as Theorized by Hobbes',
  '홉스는 사회의 통합을 보호하려는 자연적 본능을 설명합니다':
    'Hobbes Explains a Natural Instinct to Protect Social Unity',
  '홉스: 도덕은 주권 국가의 통제 아래서만 시작됩니다':
    'Hobbes: Morality Begins Only Under the Control of a Sovereign State',
  '인간은 본질적으로 사회적이며 협동적이라고 홉스는 주장합니다':
    'Hobbes Argues Humans Are Inherently Social and Cooperative',
  '공동의 힘이 없는 전쟁으로 묘사되는 자연의 상태':
    'The State of Nature Depicted as a War Without a Common Power',
  '홉스는 인간을 자연 상태의 반사회적 존재로 보았습니다':
    'Hobbes Saw Humans as Antisocial Beings in the State of Nature',
  '도덕성은 주권적 권력이 없는 자연스러운 조건에서 번성합니다':
    'Morality Thrives in Natural Conditions Without Sovereign Power',
  '홉스에 따르면 두려움은 인간의 움직임에 영향을 미치지 않습니다':
    'According to Hobbes, Fear Does Not Affect Human Movement',
  '홉스, 상호 애정이 인간 사회를 세웠다고 주장하다':
    'Hobbes Argues That Mutual Affection Built Human Society',
  '사회는 애정이 아닌 공유된 두려움에서 형성된다고 홉스는 말합니다':
    'Hobbes Says Society Forms from Shared Fear, Not Affection',
  // 주제 (명사구)
  '인간이 자연 상태에서 도덕적으로 행동하는 이유': 'why humans act morally in the state of nature',
  '인간은 자연스럽게 평화로운 공동체를 형성합니다': 'humans naturally forming peaceful communities',
  '사람들을 조화롭게 하나로 모으는 자연의 힘': 'the natural force that harmoniously brings people together',
  '인간 행동을 통제하는 국가의 역할': 'the role of the state in controlling human behavior',
  '자연 상태에서의 이타주의의 중요성': 'the importance of altruism in the state of nature',
  '전쟁 상태가 사회에 미치는 긍정적 영향': 'the positive effects of a state of war on society',
  '도덕적 적용을 위한 주권적 권력의 필요성': 'the need for sovereign power for the application of morality',
  '자연 상태의 사람들의 상호 애정': 'the mutual affection of people in the state of nature',
  '자연 상태에서 자연스럽게 사교적일 때의 장점': 'the advantages of being naturally sociable in the state of nature',
  '본능이 인간의 자연스러운 행동에 미치는 영향': "the influence of instinct on humans' natural behavior",
  '짧고 잔인한 삶의 유익한 효과': 'the beneficial effects of a short and brutish life',
  '고독하고 가난한 삶이 주는 혜택': 'the benefits of a solitary and poor life',
  '자연에서 인류의 반사회적 상태의 원인': "the cause of humanity's antisocial condition in nature",
  '평화로운 사회에서 공포를 조성하는 것의 어려움': 'the difficulty of creating fear in a peaceful society',
  '주권 국가 없이 사는 것의 장점': 'the advantages of living without a sovereign state',
  '사회 형성에서 상호 공포의 중요성': 'the importance of mutual fear in forming society',
  '사회 집회를 위한 상호 사랑의 필요성': 'the need for mutual love to assemble society',
  '일반적인 힘의 부족이 인간의 삶에 미치는 영향': 'the effect of the lack of a common power on human life',
  '권위 없이 사회적 조화를 이루기 어려움': 'the difficulty of achieving social harmony without authority',
};

async function main() {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const now = new Date();
  const docs = await col
    .find({ source: SOURCE, type: { $in: ['일치', '불일치', '제목', '주제'] }, deleted_at: null })
    .toArray();

  const report: Record<string, unknown>[] = [];
  const missing = new Set<string>();
  let applied = 0;

  for (const d of docs) {
    const qd = (d.question_data ?? {}) as Record<string, unknown>;
    const raw = String(qd.Options ?? '');
    if (!HANGUL_RE.test(raw)) continue;
    const segs = splitQuestionOptionSegments(raw);
    if (segs.length !== 5) { report.push({ id: String(d._id), error: `보기 ${segs.length}개` }); continue; }
    const en: string[] = [];
    let ok = true;
    for (const s of segs) {
      const key = normKey(s);
      const v = KO2EN[key];
      if (!v) { ok = false; missing.add(key); }
      else en.push(v);
    }
    if (!ok) { report.push({ id: String(d._id), type: d.type, error: '매핑 누락' }); continue; }
    const newOptions = en.map((e, i) => `${CIRCLED[i]} ${e}`).join(' ### ');
    report.push({ id: String(d._id), type: d.type, ca: qd.CorrectAnswer, action: APPLY ? '교체' : '교체 예정' });
    applied++;
    if (APPLY) {
      await col.updateOne({ _id: d._id }, { $set: { 'question_data.Options': newOptions, updated_at: now } });
    }
  }

  console.log(JSON.stringify({
    ok: true, apply: APPLY, applied,
    skipped: report.filter((r) => 'error' in r),
    missingKeys: [...missing],
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
