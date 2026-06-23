'use client';

import { useState } from 'react';
import { getPublicSiteUrl } from '@/lib/site-branding';

/** 외부 개발자에게 안내할 공개(배포) 베이스 URL — 로컬 origin 이 아니라 배포 도메인. */
const PUBLIC_BASE = getPublicSiteUrl() || 'https://gomijoshua.com';

/* ─────────── 작은 UI 헬퍼 ─────────── */

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* ignore */ } }}
      className="absolute top-2.5 right-2.5 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[11px] text-zinc-300 transition-colors"
    >
      {done ? '복사됨!' : '복사'}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="relative group">
      <pre className="overflow-x-auto rounded-lg bg-[#0f172a] text-[#e2e8f0] text-[12.5px] leading-relaxed p-4 font-mono whitespace-pre">{children}</pre>
      <CopyButton text={children} />
    </div>
  );
}

function ParamRow({ name, type, def, desc }: { name: string; type: string; def: string; desc: string }) {
  return (
    <tr className="border-b border-slate-100 last:border-b-0">
      <td className="py-2.5 pr-3 align-top"><code className="text-[12.5px] text-indigo-700 font-mono">{name}</code></td>
      <td className="py-2.5 pr-3 align-top text-[12px] text-slate-500 font-mono">{type}</td>
      <td className="py-2.5 pr-3 align-top text-[12px] text-slate-500">{def}</td>
      <td className="py-2.5 align-top text-[13px] text-slate-700">{desc}</td>
    </tr>
  );
}

const NAV = [
  ['overview', '개요'],
  ['auth', '인증'],
  ['endpoint', '엔드포인트'],
  ['params', '요청 파라미터'],
  ['response', '응답 형식'],
  ['examples', '예제'],
  ['errors', '에러'],
  ['notes', '비고'],
] as const;

export default function QuestionBankApiDocs() {
  const [lang, setLang] = useState<'curl' | 'js' | 'python'>('curl');

  const ep = `${PUBLIC_BASE}/api/public/question-bank`;

  const codeExamples: Record<typeof lang, string> = {
    curl: `curl -H "Authorization: Bearer qbk_전달받은_키" \\\n  "${ep}?limit=10"`,
    js: `const res = await fetch(\n  "${ep}?limit=10",\n  { headers: { Authorization: "Bearer qbk_전달받은_키" } }\n);\nconst data = await res.json();\nconsole.log(data.total, data.items);`,
    python: `import requests\n\nres = requests.get(\n    "${ep}",\n    headers={"Authorization": "Bearer qbk_전달받은_키"},\n    params={"limit": 10},\n)\ndata = res.json()\nprint(data["total"], data["items"])`,
  };

  const exampleResponse = `{
  "ok": true,
  "total": 128,
  "count": 1,
  "limit": 10,
  "offset": 0,
  "items": [
    {
      "serialNo": 10234,
      "type": "어법",
      "textbook": "22년 9월 고1 영어모의고사",
      "source": "22년 9월 고1 영어모의고사 33번",
      "difficulty": "중",
      "folder": "",
      "tags": [],
      "savedAt": "2026-06-20T08:12:00.000Z",
      "questionId": "6a37369a8d77f40ebd233f2d",
      "questionData": {
        "Question": "다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?",
        "Paragraph": "<p>...본문...</p>",
        "Options": ["①...", "②...", "③...", "④...", "⑤..."],
        "OptionType": "English",
        "CorrectAnswer": "③",
        "Explanation": "..."
      }
    }
  ]
}`;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      {/* 헤더 */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-[#c9a44e] to-[#e8d48b] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2L10.5 6.5L15 7.5L11.5 11L12.5 15.5L8 13L3.5 15.5L4.5 11L1 7.5L5.5 6.5L8 2Z" fill="#1a1500" fillOpacity="0.9" /></svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">문제은행 API <span className="ml-1 align-middle text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">v1</span></h1>
            <p className="text-[12px] text-slate-500">내 문제은행을 외부에서 불러쓰는 읽기 전용 REST API</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 flex gap-8">
        {/* TOC */}
        <nav className="hidden lg:block w-44 shrink-0">
          <div className="sticky top-8 space-y-1">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="block text-[13px] text-slate-500 hover:text-slate-900 py-1 transition-colors">{label}</a>
            ))}
          </div>
        </nav>

        {/* 본문 */}
        <main className="flex-1 min-w-0 space-y-10">
          <section id="overview" className="scroll-mt-8 space-y-3">
            <h2 className="text-base font-bold">개요</h2>
            <p className="text-[14px] leading-relaxed text-slate-700">
              이 API는 선생님이 「문제 관리」에서 <b>내 문제은행에 담아둔 문항</b>을 외부 시스템(LMS·자체 사이트 등)에서 불러올 수 있게 합니다. <b>읽기 전용</b>이며, 발급한 API 키로 인증합니다. 키 한 개는 그 키를 발급한 선생님의 문제은행에만 접근합니다.
            </p>
            <div className="rounded-lg bg-white border border-slate-200 p-4 text-[13px]">
              <span className="text-slate-500">Base URL</span>
              <div className="mt-1"><code className="text-[13px] text-indigo-700 font-mono break-all">{PUBLIC_BASE}</code></div>
            </div>
          </section>

          <section id="auth" className="scroll-mt-8 space-y-3">
            <h2 className="text-base font-bold">인증</h2>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 text-[13px] text-amber-900">
              <b>키 발급은 계정 소유자(선생님)가 합니다.</b> 선생님이 자신의 관리자 화면에서 API 키를 만들어 전달하고, <b>외부 시스템은 전달받은 키만 있으면 됩니다.</b> (이 문서에는 발급 화면 링크가 없습니다 — 로그인이 필요한 내부 화면입니다.)
            </div>
            <p className="text-[14px] leading-relaxed text-slate-700">
              전달받은 키를 모든 요청에 다음 두 방식 중 하나로 포함하세요.
            </p>
            <Code>{`# 1) 헤더 (권장)\nAuthorization: Bearer qbk_전달받은_키\n\n# 2) 쿼리 파라미터\n${ep}?key=qbk_전달받은_키`}</Code>
            <p className="text-[12.5px] text-slate-500">키는 비밀번호처럼 다뤄 주세요. 노출되면 발급자(선생님)가 폐기 후 새로 발급합니다.</p>
          </section>

          <section id="endpoint" className="scroll-mt-8 space-y-3">
            <h2 className="text-base font-bold">엔드포인트</h2>
            <div className="rounded-lg bg-white border border-slate-200 p-4">
              <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[11px] font-bold font-mono mr-2">GET</span>
              <code className="text-[13px] text-slate-800 font-mono break-all">/api/public/question-bank</code>
              <p className="mt-2 text-[13px] text-slate-600">내 문제은행 문항을 본문(questionData)과 함께 최신순으로 반환합니다.</p>
            </div>
          </section>

          <section id="params" className="scroll-mt-8 space-y-3">
            <h2 className="text-base font-bold">요청 파라미터</h2>
            <p className="text-[13px] text-slate-600">모두 선택입니다. 쿼리스트링으로 전달합니다.</p>
            <div className="rounded-lg bg-white border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2.5 px-4 font-semibold">이름</th>
                    <th className="py-2.5 pr-3 font-semibold">타입</th>
                    <th className="py-2.5 pr-3 font-semibold">기본값</th>
                    <th className="py-2.5 font-semibold">설명</th>
                  </tr>
                </thead>
                <tbody className="px-4">
                  <tr><td colSpan={4} className="px-4 pt-1" /></tr>
                  <ParamRow name="folder" type="string" def="전체" desc="폴더명으로 필터합니다. 미분류는 빈 문자열('')." />
                  <ParamRow name="type" type="string" def="전체" desc="유형으로 필터합니다 (빈칸·순서·삽입·어법·어휘·주제·제목 등)." />
                  <ParamRow name="limit" type="number" def="50" desc="한 번에 가져올 개수 (1–200)." />
                  <ParamRow name="offset" type="number" def="0" desc="건너뛸 개수. 페이지네이션에 사용 (offset += limit)." />
                  <tr><td colSpan={4} className="px-4 pb-1" /></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="response" className="scroll-mt-8 space-y-3">
            <h2 className="text-base font-bold">응답 형식</h2>
            <p className="text-[13px] text-slate-600">최상위 필드</p>
            <div className="rounded-lg bg-white border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <tbody>
                  <tr><td colSpan={4} className="px-4 pt-1" /></tr>
                  <ParamRow name="ok" type="boolean" def="—" desc="성공 여부." />
                  <ParamRow name="total" type="number" def="—" desc="필터 조건에 맞는 전체 문항 수." />
                  <ParamRow name="count" type="number" def="—" desc="이번 응답에 담긴 문항 수." />
                  <ParamRow name="limit / offset" type="number" def="—" desc="요청에 적용된 페이지 값." />
                  <ParamRow name="items" type="array" def="—" desc="문항 배열 (아래)." />
                  <tr><td colSpan={4} className="px-4 pb-1" /></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-slate-600 pt-1">items[] 각 문항</p>
            <div className="rounded-lg bg-white border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <tbody>
                  <tr><td colSpan={4} className="px-4 pt-1" /></tr>
                  <ParamRow name="serialNo" type="number|null" def="—" desc="문항 고유 번호." />
                  <ParamRow name="type" type="string" def="—" desc="문항 유형." />
                  <ParamRow name="textbook" type="string" def="—" desc="교재명." />
                  <ParamRow name="source" type="string" def="—" desc="원문 출처." />
                  <ParamRow name="difficulty" type="string" def="—" desc="난이도 (하·중·상)." />
                  <ParamRow name="folder / tags" type="string / array" def="—" desc="내 문제은행에서의 분류·태그." />
                  <ParamRow name="savedAt" type="ISO date" def="—" desc="문제은행에 담은 시각." />
                  <ParamRow name="questionId" type="string" def="—" desc="문항 원본 ID." />
                  <ParamRow name="questionData" type="object|null" def="—" desc="문항 본문 (아래). 원본이 삭제된 경우 null." />
                  <tr><td colSpan={4} className="px-4 pb-1" /></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-slate-600 pt-1">questionData (문항 본문)</p>
            <div className="rounded-lg bg-white border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <tbody>
                  <tr><td colSpan={4} className="px-4 pt-1" /></tr>
                  <ParamRow name="Question" type="string" def="—" desc="발문." />
                  <ParamRow name="Paragraph" type="string(HTML)" def="—" desc="지문 본문 (HTML 포함 가능)." />
                  <ParamRow name="Options" type="string[]" def="—" desc="선택지 배열." />
                  <ParamRow name="OptionType" type="string" def="—" desc="선택지 언어 구분 (English/Korean)." />
                  <ParamRow name="CorrectAnswer" type="string" def="—" desc="정답 (①②③④⑤ 중 하나)." />
                  <ParamRow name="Explanation" type="string" def="—" desc="해설 (있는 경우)." />
                  <tr><td colSpan={4} className="px-4 pb-1" /></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="examples" className="scroll-mt-8 space-y-3">
            <h2 className="text-base font-bold">예제</h2>
            <div className="flex gap-1 text-[13px]">
              {([['curl', 'cURL'], ['js', 'JavaScript'], ['python', 'Python']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setLang(k)} className={`px-3 py-1.5 rounded-md transition-colors ${lang === k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>
            <Code>{codeExamples[lang]}</Code>
            <p className="text-[13px] text-slate-600 pt-1">응답 예시</p>
            <Code>{exampleResponse}</Code>
          </section>

          <section id="errors" className="scroll-mt-8 space-y-3">
            <h2 className="text-base font-bold">에러</h2>
            <div className="rounded-lg bg-white border border-slate-200 overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2.5 px-4 font-semibold">상태</th>
                    <th className="py-2.5 font-semibold">의미</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-100"><td className="py-2.5 px-4"><code className="font-mono text-rose-600">401</code></td><td className="py-2.5 text-[13px] text-slate-700">API 키가 없음 — Authorization 헤더 또는 ?key= 누락.</td></tr>
                  <tr className="border-b border-slate-100"><td className="py-2.5 px-4"><code className="font-mono text-rose-600">403</code></td><td className="py-2.5 text-[13px] text-slate-700">유효하지 않거나 폐기된 키.</td></tr>
                  <tr><td className="py-2.5 px-4"><code className="font-mono text-slate-600">200</code></td><td className="py-2.5 text-[13px] text-slate-700">정상 — 결과가 없으면 <code className="font-mono">items: []</code>, <code className="font-mono">total: 0</code>.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-slate-600">에러 응답 형식</p>
            <Code>{`{ "ok": false, "error": "유효하지 않은 API 키입니다." }`}</Code>
          </section>

          <section id="notes" className="scroll-mt-8 space-y-2 pb-12">
            <h2 className="text-base font-bold">비고</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-[13.5px] text-slate-700">
              <li><b>읽기 전용</b> — 이 API로는 문항을 수정·삭제할 수 없습니다.</li>
              <li><b>CORS 허용</b> — 브라우저(프런트엔드)에서도 직접 호출할 수 있습니다. 단, 키가 노출되니 가능하면 서버에서 호출하세요.</li>
              <li><b>페이지네이션</b> — <code className="font-mono">total</code> 이 <code className="font-mono">limit</code> 보다 크면 <code className="font-mono">offset</code> 을 늘려 이어서 가져오세요.</li>
              <li>문항을 더 노출하려면 「문제 관리」에서 문제은행에 더 담으면 됩니다.</li>
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
