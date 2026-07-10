'use client';

import { useEffect, useRef, useState } from 'react';

interface ApiKey { id: string; key: string; label: string }

/** 복사 버튼 */
function Copy({ text, id, copied, setCopied }: { text: string; id: string; copied: string | null; setCopied: (v: string | null) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          navigator.clipboard?.writeText(text);
          setCopied(id);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(null), 1500);
        } catch { /* 클립보드 미지원 */ }
      }}
      className="shrink-0 rounded border border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
    >
      {copied === id ? '✓ 복사됨' : '복사'}
    </button>
  );
}

function CodeBlock({ code, id, copied, setCopied }: { code: string; id: string; copied: string | null; setCopied: (v: string | null) => void }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2"><Copy text={code} id={id} copied={copied} setCopied={setCopied} /></div>
      <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 pr-16 font-mono text-[12px] leading-relaxed text-zinc-300">{code}</pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-lg font-bold text-zinc-100 border-b border-zinc-800 pb-1.5">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function GrammarApiDocsPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [keysError, setKeysError] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch('/api/my/vip/api-keys', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d?.ok && Array.isArray(d.keys)) setKeys(d.keys); else setKeysError(true); })
      .catch(() => setKeysError(true));
  }, []);

  const endpoint = `${origin || 'https://<도메인>'}/api/public/writing-bank`;
  const sampleKey = keys?.[0]?.key ?? '<API_KEY>';
  const exTopicKey = '천일문 중등 WRITING LEVEL 1 > 조동사 > must, have to, should';

  const curlList = `curl "${endpoint}?topicKey=${encodeURIComponent(exTopicKey)}&format=mc" \\
  -H "Authorization: Bearer ${sampleKey}"`;

  const curlMeta = `curl "${endpoint}?meta=topics" \\
  -H "Authorization: Bearer ${sampleKey}"`;

  const jsCode = `const BASE = '${endpoint}';
const KEY = '${sampleKey}';

// 특정 진도의 객관식 문제 불러오기
const res = await fetch(
  BASE + '?' + new URLSearchParams({
    course: '천일문 중등 WRITING LEVEL 1',
    topic: 'must, have to, should',
    format: 'mc',        // 'subjective' 로 바꾸면 주관식 원형
    limit: '20',
  }),
  { headers: { Authorization: 'Bearer ' + KEY } }
);
const data = await res.json();
for (const q of data.items) {
  console.log(q.serial, q.question);   // W-000xxx / 문항(밑줄은 <u>..</u>)
  console.log(q.options);              // ["was", "is", ...] — ①~④ 순
  console.log(q.answer);               // "③" (객관식) 또는 텍스트(주관식)
}`;

  const pyCode = `import requests

BASE = "${endpoint}"
KEY  = "${sampleKey}"

# 무작위 10문항 (문제지 출제용)
r = requests.get(BASE, headers={"Authorization": f"Bearer {KEY}"}, params={
    "course": "천일문 중등 WRITING LEVEL 1",
    "topic":  "can, may",
    "sample": 10,
    "format": "mc",
})
data = r.json()
for q in data["items"]:
    print(q["serial"], q["question"], q["options"], "정답", q["answer"])`;

  const respJson = `{
  "ok": true,
  "total": 12,
  "count": 12,
  "limit": 50,
  "offset": 0,
  "format": "mc",
  "items": [
    {
      "serial": "W-000060",
      "topicKey": "천일문 중등 WRITING LEVEL 1 > 조동사 > must, have to, should",
      "course": "천일문 중등 WRITING LEVEL 1",
      "chapter": "조동사",
      "topic": "can, may",
      "unit": 10,
      "section": "B",
      "no": 6,
      "format": "mc",
      "type": "객관식",
      "instruction": "다음 빈칸에 들어갈 알맞은 말을 고르시오.",
      "question": "She ____ speak three languages.",
      "options": ["can", "cans", "canning", "to can"],
      "answer": "①",
      "explanation": "능력을 나타내는 can 뒤에는 동사원형이 온다.",
      "source": "자체 제작 LEVEL 1"
    }
  ]
}`;

  const params: Array<[string, string, string]> = [
    ['meta', '"topics" 로 주면 진도(topicKey)별 문항 수 목록만 반환 (외부 트리·셀렉터 구성용)', '문자열'],
    ['topicKey', '진도 키 정확 일치. 예) "천일문 중등 WRITING LEVEL 1 > 조동사 > must, have to, should"', '문자열'],
    ['course', '과정(레벨) 필터. 예) "천일문 중등 WRITING LEVEL 1"', '문자열'],
    ['chapter', '대단원 필터. 예) "조동사"', '문자열'],
    ['topic', '학습주제 필터. 예) "can, may"', '문자열'],
    ['source', '출처 필터. 예) "자체 제작 LEVEL 1"', '문자열'],
    ['format', 'mc(기본, ①~④ 객관식) | subjective(주관식 원형·빈칸/영작)', '문자열'],
    ['sample', '조건 내 무작위 N문항 (문제지 출제용). 지정 시 offset 무시. 최대 200', '정수'],
    ['limit', '한 번에 가져올 개수. 기본 50, 최대 200', '정수'],
    ['offset', '건너뛸 개수 (페이지네이션)', '정수'],
  ];

  const fields: Array<[string, string]> = [
    ['serial', '문항 고유번호 (W-000001 …). 채점·오답 관리 키'],
    ['topicKey / course / chapter / topic', '진도 좌표'],
    ['unit / section / no', '교재 내 위치 (유닛·섹션 A~D·번호)'],
    ['type', '선택형 | 객관식 | (주관식일 때) 빈칸(보기)·고쳐쓰기·영작'],
    ['instruction', '섹션 지시문'],
    ['question', '문항 본문. 밑줄은 <u>…</u> 로 표기'],
    ['options', '객관식 선택지 배열 — ①②③④ 순서 (없으면 생략)'],
    ['choices', '주관식 |보기| 배열 (빈칸(보기) 유형)'],
    ['answer', '정답 — 객관식은 "①"~"④", 주관식은 정답 텍스트'],
    ['explanation', '한 줄 해설'],
    ['source', '출처 라벨'],
  ];

  const toc = [
    ['overview', '개요'],
    ['auth', '인증'],
    ['keys', '내 API 키'],
    ['endpoint', '엔드포인트'],
    ['params', '요청 파라미터'],
    ['response', '응답 형식'],
    ['examples', '코드 예시'],
    ['errors', '에러'],
    ['notes', '참고'],
  ];

  return (
    <div className="space-y-6 pb-16">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">API 문서</span>
            <span className="rounded bg-emerald-500/15 text-emerald-300 text-[11px] px-1.5 py-0.5 border border-emerald-500/30">v1</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold text-zinc-100">라이팅 문제은행 API</h1>
          <p className="text-sm text-zinc-500 mt-0.5">다른 웹·앱에서 라이팅 문제은행을 불러오는 공개 REST API 공식 문서입니다.</p>
        </div>
        <div className="no-print flex shrink-0 items-center gap-2">
          <a
            href="/api/my/vip/writing-problems/api-docs/pdf"
            className="rounded-lg bg-gradient-to-r from-[#c9a44e] to-amber-600 px-3 py-2 text-sm font-bold text-zinc-950 hover:opacity-90"
          >
            ⬇ PDF 다운로드
          </a>
          <a href="/my/vip/writing-problems" className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500">← 라이팅 문제관리</a>
        </div>
      </div>

      {/* 목차 */}
      <nav className="no-print flex flex-wrap gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3">
        {toc.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-md px-2.5 py-1 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">{label}</a>
        ))}
      </nav>

      <Section id="overview" title="개요">
        <p className="text-sm text-zinc-400 leading-relaxed">
          진도(레벨·챕터·학습주제) 기준으로 문법 문제를 <b className="text-zinc-200">객관식(①~④)</b> 또는 <b className="text-zinc-200">주관식 원형</b>으로 내려받습니다.
          모든 문항에는 고유번호(<code className="font-mono text-[#e8d48b]">serial</code>)가 있어 채점·오답 관리에 바로 쓸 수 있습니다. 방식은 <code className="font-mono">GET</code> 요청 하나이며 JSON 을 반환합니다.
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
          <span className="shrink-0 rounded bg-emerald-600/20 px-1.5 py-0.5 text-[11px] font-bold text-emerald-300">GET</span>
          <code className="flex-1 break-all font-mono text-[13px] text-emerald-300">{endpoint}</code>
          <Copy text={endpoint} id="ep" copied={copied} setCopied={setCopied} />
        </div>
      </Section>

      <Section id="auth" title="인증">
        <p className="text-sm text-zinc-400 leading-relaxed">
          모든 요청에 API 키가 필요합니다. <b className="text-zinc-200">문제은행 API 와 같은 키</b>를 사용합니다. 두 방법 중 하나:
        </p>
        <ul className="text-sm text-zinc-400 space-y-1.5 list-disc pl-5">
          <li><code className="font-mono text-[#e8d48b]">Authorization: Bearer &lt;KEY&gt;</code> 헤더 <span className="text-zinc-600">(권장)</span></li>
          <li>쿼리 <code className="font-mono text-[#e8d48b]">?key=&lt;KEY&gt;</code> <span className="text-zinc-600">— 서버 간 호출 등 헤더를 못 넣을 때만. URL 로그에 남으니 주의</span></li>
        </ul>
      </Section>

      <Section id="keys" title="내 API 키">
        {keys === null && !keysError && <p className="text-[13px] text-zinc-600">불러오는 중…</p>}
        {keysError && (
          <p className="text-[13px] text-zinc-400">키를 불러오지 못했습니다. <a href="/my/vip/qbank-api" className="text-[#e8d48b] underline">문제은행 API 메뉴</a>에서 발급·확인하세요.</p>
        )}
        {keys && keys.length === 0 && (
          <p className="text-[13px] text-zinc-400">발급된 키가 없습니다. <a href="/my/vip/qbank-api" className="text-[#e8d48b] underline">문제은행 API 메뉴</a>에서 발급하세요.</p>
        )}
        {keys && keys.map((k) => (
          <div key={k.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{k.label}</span>
            <code className="flex-1 break-all font-mono text-[12px] text-zinc-300">{k.key}</code>
            <Copy text={k.key} id={`k-${k.id}`} copied={copied} setCopied={setCopied} />
          </div>
        ))}
        <p className="text-[11px] text-zinc-600">키 발급·폐기·호출 로그: <a href="/my/vip/qbank-api" className="underline hover:text-zinc-400">문제은행 API 메뉴</a></p>
      </Section>

      <Section id="endpoint" title="엔드포인트">
        <p className="text-sm text-zinc-400">파라미터 조합에 따라 세 가지로 동작합니다.</p>
        <div className="space-y-2">
          {[
            ['진도 목록', '?meta=topics', '진도(topicKey)별 문항 수만 반환 — 외부에서 트리/드롭다운 구성'],
            ['문항 조회', '?topicKey=… 또는 ?course=&topic=', '조건에 맞는 문항을 순서대로 (limit/offset 페이지네이션)'],
            ['무작위 출제', '?…&sample=N', '조건 내 무작위 N문항 (문제지 자동 출제)'],
          ].map(([t, q, d]) => (
            <div key={q} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded bg-[#c9a44e]/15 text-[#e8d48b] text-[11px] font-semibold px-1.5 py-0.5">{t}</span>
                <code className="font-mono text-[12px] text-zinc-300">{q}</code>
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="params" title="요청 파라미터">
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">파라미터</th>
                <th className="px-3 py-2 font-semibold">타입</th>
                <th className="px-3 py-2 font-semibold">설명</th>
              </tr>
            </thead>
            <tbody>
              {params.map(([name, desc, type], i) => (
                <tr key={name} className={i % 2 ? 'bg-zinc-950/40' : 'bg-zinc-900/30'}>
                  <td className="px-3 py-2 align-top"><code className="font-mono text-[#e8d48b]">{name}</code></td>
                  <td className="px-3 py-2 align-top text-zinc-500 whitespace-nowrap">{type}</td>
                  <td className="px-3 py-2 align-top text-zinc-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="response" title="응답 형식">
        <p className="text-sm text-zinc-400"><code className="font-mono">items[]</code> 각 문항의 주요 필드:</p>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-zinc-900 text-zinc-400"><tr><th className="px-3 py-2 font-semibold">필드</th><th className="px-3 py-2 font-semibold">설명</th></tr></thead>
            <tbody>
              {fields.map(([name, desc], i) => (
                <tr key={name} className={i % 2 ? 'bg-zinc-950/40' : 'bg-zinc-900/30'}>
                  <td className="px-3 py-2 align-top"><code className="font-mono text-[#e8d48b]">{name}</code></td>
                  <td className="px-3 py-2 align-top text-zinc-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-zinc-500">예시 응답 (<code className="font-mono">?topicKey=…&format=mc&limit=1</code>):</p>
        <CodeBlock code={respJson} id="resp" copied={copied} setCopied={setCopied} />
      </Section>

      <Section id="examples" title="코드 예시">
        <p className="text-[12px] font-semibold text-zinc-500">curl — 진도 목록</p>
        <CodeBlock code={curlMeta} id="cm" copied={copied} setCopied={setCopied} />
        <p className="text-[12px] font-semibold text-zinc-500">curl — 특정 진도 객관식</p>
        <CodeBlock code={curlList} id="cl" copied={copied} setCopied={setCopied} />
        <p className="text-[12px] font-semibold text-zinc-500">JavaScript (fetch)</p>
        <CodeBlock code={jsCode} id="js" copied={copied} setCopied={setCopied} />
        <p className="text-[12px] font-semibold text-zinc-500">Python (requests)</p>
        <CodeBlock code={pyCode} id="py" copied={copied} setCopied={setCopied} />
      </Section>

      <Section id="errors" title="에러">
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-zinc-900 text-zinc-400"><tr><th className="px-3 py-2 font-semibold">상태</th><th className="px-3 py-2 font-semibold">의미</th></tr></thead>
            <tbody>
              <tr className="bg-zinc-900/30"><td className="px-3 py-2"><code className="font-mono text-emerald-300">200</code></td><td className="px-3 py-2 text-zinc-400">정상 — <code className="font-mono">{'{ ok: true, items: [...] }'}</code></td></tr>
              <tr className="bg-zinc-950/40"><td className="px-3 py-2"><code className="font-mono text-rose-300">401</code></td><td className="px-3 py-2 text-zinc-400">API 키 없음</td></tr>
              <tr className="bg-zinc-900/30"><td className="px-3 py-2"><code className="font-mono text-rose-300">403</code></td><td className="px-3 py-2 text-zinc-400">유효하지 않은 API 키</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="notes" title="참고">
        <ul className="text-sm text-zinc-400 space-y-1.5 list-disc pl-5">
          <li><b className="text-zinc-200">CORS</b>: 모든 도메인 허용(<code className="font-mono">Access-Control-Allow-Origin: *</code>) — 브라우저에서 바로 호출 가능.</li>
          <li>본문의 <code className="font-mono text-[#e8d48b]">&lt;u&gt;…&lt;/u&gt;</code> 는 밑줄. 객관식 <code className="font-mono">answer</code> 가 "③" 이면 <code className="font-mono">options[2]</code> 가 정답 내용입니다.</li>
          <li>반환 대상은 <b className="text-zinc-200">내가 만든/보유한 문항</b>뿐입니다(키 소유자 기준). 출판 교재 답지 등 내부 자료는 이 API 로 나가지 않습니다.</li>
          <li>모든 호출은 <a href="/my/vip/qbank-api" className="underline hover:text-zinc-300">문제은행 API 메뉴</a>의 호출 로그에 기록됩니다.</li>
        </ul>
      </Section>
    </div>
  );
}
