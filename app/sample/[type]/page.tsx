import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { getVariantTypeGuide, baseVariantType } from '@/app/data/variant-type-guides';
import { variantUnitPrice, isAdvancedVariantType } from '@/lib/variant-pricing';
import BackButton from './BackButton';

export const dynamic = 'force-dynamic';

type SampleDoc = {
  type: string;
  source?: string;
  textbook?: string;
  question_data?: Record<string, unknown>;
};

/** 해당 유형의 대표 샘플 1문항 — 완료본 우선, 없으면 아무거나, 그래도 없으면 base 유형으로 폴백 */
async function fetchSample(type: string): Promise<{ doc: SampleDoc; usedBase: boolean } | null> {
  const db = await getDb('gomijoshua');
  const col = db.collection('generated_questions');
  const base = baseVariantType(type);
  const candidates = type === base ? [type] : [type, base];
  for (const t of candidates) {
    const doc =
      (await col.findOne({ type: t, status: '완료' }, { sort: { updated_at: -1 } })) ??
      (await col.findOne({ type: t }, { sort: { updated_at: -1 } }));
    if (doc) return { doc: doc as unknown as SampleDoc, usedBase: t !== type };
  }
  return null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** Paragraph: ###·줄바꿈을 <br> 로 (본문의 <u>/<b> 태그는 보존) */
const paragraphHtml = (s: string) => str(s).replace(/\s*###\s*/g, '<br/>').replace(/\n/g, '<br/>');
const splitOptions = (s: string) => str(s).split(/\s*###\s*/).map((x) => x.trim()).filter(Boolean);

export default async function VariantSamplePage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { type: rawType } = await params;
  const { embed } = await searchParams;
  const isEmbed = embed === '1'; // 드로어(iframe) 내장 — 뒤로가기 버튼 숨김
  const type = decodeURIComponent(rawType ?? '').trim();
  const guide = getVariantTypeGuide(type);
  if (!guide) notFound();

  const sample = await fetchSample(type);
  const qd = sample?.doc.question_data ?? {};
  const price = variantUnitPrice(type);

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="mt-6">
      <h2 className="text-base font-bold text-slate-800 mb-2">{title}</h2>
      <div className="text-[15px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );

  return (
    <main className="min-h-svh bg-slate-50 py-8 px-4">
      <div className="mx-auto w-full max-w-2xl">
        {/* 상단 좌측 뒤로가기 (드로어 내장 시 숨김) */}
        {!isEmbed && (
          <div className="mb-4">
            <BackButton />
          </div>
        )}

        {/* 헤더 */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold text-slate-900">{guide.label}</h1>
          {guide.isAdvanced && (
            <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">고난도</span>
          )}
          <span className="text-xs font-medium text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
            문항당 {price.toLocaleString()}원
          </span>
        </div>
        <p className="mt-1 text-slate-600">{guide.blurb}</p>

        {/* 이런 유형이에요 */}
        <Section title="📘 이런 유형이에요">
          <p>{guide.whatItTests}</p>
          {guide.advancedNote && (
            <p className="mt-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-[14px] text-orange-900">
              <b className="font-bold">고난도 포인트 · </b>{guide.advancedNote}
            </p>
          )}
        </Section>

        {/* 샘플 문제 */}
        <Section title="📝 샘플 문제">
          {sample ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              {sample.usedBase && (
                <p className="mb-3 text-[12px] text-slate-500 bg-slate-100 rounded px-2 py-1">
                  ※ 이 유형의 문항이 아직 준비 중이라, 구조가 같은 <b>기본 「{baseVariantType(type)}」</b> 문항을 예시로 보여드립니다. 실제 고난도 문항은 위 「고난도 포인트」대로 난도가 높아집니다.
                </p>
              )}
              {str(qd.Question) && (
                <p className="font-semibold text-slate-900 mb-2">{str(qd.Question)}</p>
              )}
              <div
                className="text-[15px] leading-7 text-slate-800 [&_u]:underline [&_u]:decoration-slate-400"
                dangerouslySetInnerHTML={{ __html: paragraphHtml(str(qd.Paragraph)) }}
              />
              <ol className="mt-3 space-y-1 text-[15px] text-slate-800">
                {splitOptions(str(qd.Options)).map((opt, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: opt }} />
                ))}
              </ol>
              {(str(qd.CorrectAnswer) || str(qd.Explanation)) && (
                <details className="mt-4 group">
                  <summary className="cursor-pointer select-none text-sm font-bold text-emerald-700 hover:text-emerald-800">
                    정답 · 해설 보기
                  </summary>
                  <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                    {str(qd.CorrectAnswer) && (
                      <p className="font-bold text-emerald-900">정답: {str(qd.CorrectAnswer)}</p>
                    )}
                    {str(qd.Explanation) && (
                      <div
                        className="mt-1 text-[14px] leading-relaxed text-slate-700"
                        dangerouslySetInnerHTML={{ __html: str(qd.Explanation).replace(/\n/g, '<br/>') }}
                      />
                    )}
                  </div>
                </details>
              )}
              {(sample.doc.textbook || sample.doc.source) && (
                <p className="mt-3 text-[11px] text-slate-400">
                  출처: {[sample.doc.textbook, sample.doc.source].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg bg-slate-100 px-3 py-3 text-slate-500">
              아직 이 유형의 샘플 문항이 준비되지 않았습니다. 곧 추가됩니다.
            </p>
          )}
        </Section>

        {/* 정답 구성 */}
        <Section title="🎯 정답은 이렇게 구성돼요">
          <p>{guide.answerStructure}</p>
        </Section>

        {/* 공부방향 */}
        <Section title="🧭 이렇게 공부하세요">
          <p>{guide.studyDirection}</p>
        </Section>
      </div>
    </main>
  );
}
