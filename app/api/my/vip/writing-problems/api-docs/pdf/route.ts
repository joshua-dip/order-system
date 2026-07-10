import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { VIP_API_KEYS_COLLECTION, type VipApiKeyDoc } from '@/lib/vip-api-keys-store';
import { renderHtmlToPdf } from '@/lib/chromium-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** GET — API 문서를 실제 PDF 파일로 다운로드 (서버 렌더, 한글 폰트 임베드). */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'writing-problems');
  if (auth instanceof NextResponse) return auth;

  const db = await getDb('gomijoshua');
  const keys = await db.collection<VipApiKeyDoc>(VIP_API_KEYS_COLLECTION)
    .find({ userId: new ObjectId(auth.userId) }).sort({ createdAt: 1 }).limit(5).toArray();
  const sampleKey = keys[0]?.key ?? '<API_KEY>';

  const origin = request.nextUrl.origin;
  const endpoint = `${origin}/api/public/writing-bank`;
  const exTopicKey = '천일문 중등 WRITING LEVEL 1 > 조동사 > must, have to, should';

  const params: Array<[string, string, string]> = [
    ['meta', '문자열', '"topics" 로 주면 진도(topicKey)별 문항 수 목록만 반환'],
    ['topicKey', '문자열', '진도 키 정확 일치. 예) 천일문 중등 WRITING LEVEL 1 &gt; 조동사 &gt; can, may'],
    ['course / chapter / topic', '문자열', '과정·대단원·학습주제 개별 필터 (topicKey 없을 때)'],
    ['source', '문자열', '출처 필터. 예) 천일문 WRITING'],
    ['format', '문자열', 'mc(기본, ①~④ 객관식) | subjective(주관식 원형)'],
    ['sample', '정수', '조건 내 무작위 N문항 (문제지 출제용). 최대 200'],
    ['limit / offset', '정수', '페이지네이션 (limit 기본 50·최대 200)'],
  ];
  const fields: Array<[string, string]> = [
    ['serial', '문항 고유번호 (G-000001 …). 채점·오답 관리 키'],
    ['topicKey / course / chapter / topic', '진도 좌표'],
    ['unit / section / no', '교재 내 위치 (유닛·섹션 A~D·번호)'],
    ['type', '선택형 | 객관식 | 빈칸(보기)·고쳐쓰기·영작(주관식)'],
    ['instruction', '섹션 지시문'],
    ['question', '문항 본문. 밑줄은 &lt;u&gt;…&lt;/u&gt;'],
    ['options', '객관식 선택지 배열 — ①②③④ 순서'],
    ['choices', '주관식 |보기| 배열'],
    ['answer', '정답 — 객관식 "①"~"④", 주관식 텍스트'],
    ['explanation', '한 줄 해설'],
    ['source', '출처 라벨'],
  ];

  const curlMeta = `curl "${endpoint}?meta=topics" \\
  -H "Authorization: Bearer ${sampleKey}"`;
  const curlList = `curl "${endpoint}?topicKey=${encodeURIComponent(exTopicKey)}&format=mc" \\
  -H "Authorization: Bearer ${sampleKey}"`;
  const jsCode = `const res = await fetch(
  '${endpoint}?' + new URLSearchParams({
    course: '천일문 중등 WRITING LEVEL 1', topic: 'must, have to, should',
    format: 'mc', limit: '20',
  }),
  { headers: { Authorization: 'Bearer ${sampleKey}' } }
);
const data = await res.json();
for (const q of data.items) {
  console.log(q.serial, q.question, q.options, q.answer);
}`;
  const pyCode = `import requests
r = requests.get("${endpoint}",
  headers={"Authorization": "Bearer ${sampleKey}"},
  params={"course": "천일문 중등 WRITING LEVEL 1", "topic": "can, may", "sample": 10})
for q in r.json()["items"]:
    print(q["serial"], q["question"], q["options"], "정답", q["answer"])`;
  const respJson = `{
  "ok": true, "total": 12, "count": 12, "format": "mc",
  "items": [{
    "serial": "W-000060",
    "topicKey": "천일문 중등 WRITING LEVEL 1 > 조동사 > must, have to, should",
    "unit": 10, "section": "B", "no": 6, "type": "객관식",
    "question": "She ____ speak three languages.",
    "options": ["can", "cans", "canning", "to can"],
    "answer": "①",
    "explanation": "능력을 나타내는 can 뒤에는 동사원형이 온다."
  }]
}`;

  const keyRows = keys.length
    ? keys.map((k) => `<div class="kv"><span class="tag">${esc(k.label)}</span><code>${esc(k.key)}</code></div>`).join('')
    : `<p class="muted">발급된 키가 없습니다. 문제은행 API 메뉴에서 발급하세요.</p>`;

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>
    * { box-sizing: border-box; }
    body { font-family: 'Apple SD Gothic Neo', sans-serif; color: #14161a; font-size: 11px; line-height: 1.5; margin: 0; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #14161a; break-after: avoid; }
    .sub { color: #6b7280; font-size: 11px; margin: 0 0 2px; }
    .badge { display: inline-block; background: #f0e6c8; color: #7a5c12; border: 1px solid #e0cf9a; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: 700; }
    .ver { display: inline-block; background: #e6f4ea; color: #17663a; border: 1px solid #bfe3cd; border-radius: 4px; padding: 1px 6px; font-size: 10px; margin-left: 4px; }
    code { font-family: 'Courier New', monospace; color: #0b5cad; background: #f4f5f7; padding: 1px 4px; border-radius: 3px; font-size: 10.5px; }
    pre { background: #f4f5f7; border: 1px solid #d4d7dc; border-radius: 6px; padding: 10px; font-family: 'Courier New', monospace; font-size: 10px; line-height: 1.55; color: #14161a; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
    .ep { display: flex; align-items: center; gap: 8px; border: 1px solid #d4d7dc; border-radius: 6px; padding: 8px 10px; background: #fafbfc; }
    .get { background: #17663a; color: #fff; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #d4d7dc; break-inside: avoid; }
    th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e4e7ea; vertical-align: top; }
    th { background: #f4f5f7; font-size: 10px; }
    td code { background: none; padding: 0; }
    .kv { display: flex; align-items: center; gap: 8px; border: 1px solid #d4d7dc; border-radius: 6px; padding: 6px 10px; margin-bottom: 5px; }
    .tag { background: #eceef1; border-radius: 3px; padding: 1px 6px; font-size: 10px; color: #4b5563; }
    .kv code { word-break: break-all; }
    ul { margin: 4px 0; padding-left: 18px; }
    li { margin: 3px 0; }
    .muted { color: #6b7280; }
    section { break-inside: avoid; }
    .cap { font-weight: 700; font-size: 10.5px; color: #4b5563; margin: 8px 0 3px; }
  </style></head><body>
    <div><span class="badge">API 문서</span><span class="ver">v1</span></div>
    <h1>라이팅 문제은행 API</h1>
    <p class="sub">다른 웹·앱에서 라이팅 문제은행을 불러오는 공개 REST API 공식 문서입니다.</p>

    <section><h2>개요</h2>
      <p>진도(레벨·챕터·학습주제) 기준으로 문법 문제를 <b>객관식(①~④)</b> 또는 <b>주관식 원형</b>으로 내려받습니다. 모든 문항에는 고유번호(<code>serial</code>)가 있어 채점·오답 관리에 바로 쓸 수 있습니다. 방식은 <code>GET</code> 요청 하나이며 JSON 을 반환합니다.</p>
      <div class="ep"><span class="get">GET</span><code style="background:none;color:#0b5cad">${esc(endpoint)}</code></div>
    </section>

    <section><h2>인증</h2>
      <p>모든 요청에 API 키가 필요합니다. <b>문제은행 API 와 같은 키</b>를 사용합니다.</p>
      <ul>
        <li><code>Authorization: Bearer &lt;KEY&gt;</code> 헤더 <span class="muted">(권장)</span></li>
        <li>쿼리 <code>?key=&lt;KEY&gt;</code> <span class="muted">— 헤더를 못 넣을 때만. URL 로그 주의</span></li>
      </ul>
    </section>

    <section><h2>내 API 키</h2>${keyRows}</section>

    <section><h2>엔드포인트</h2>
      <p>파라미터 조합에 따라 세 가지로 동작합니다.</p>
      <ul>
        <li><b>진도 목록</b> <code>?meta=topics</code> — 진도별 문항 수만 반환</li>
        <li><b>문항 조회</b> <code>?topicKey=…</code> 또는 <code>?course=&amp;topic=</code> — 조건에 맞는 문항</li>
        <li><b>무작위 출제</b> <code>?…&amp;sample=N</code> — 무작위 N문항</li>
      </ul>
    </section>

    <section><h2>요청 파라미터</h2>
      <table><thead><tr><th style="width:26%">파라미터</th><th style="width:12%">타입</th><th>설명</th></tr></thead><tbody>
        ${params.map(([n, t, d]) => `<tr><td><code>${n}</code></td><td class="muted">${t}</td><td>${d}</td></tr>`).join('')}
      </tbody></table>
    </section>

    <section><h2>응답 형식</h2>
      <p><code>items[]</code> 각 문항의 주요 필드:</p>
      <table><thead><tr><th style="width:32%">필드</th><th>설명</th></tr></thead><tbody>
        ${fields.map(([n, d]) => `<tr><td><code>${n}</code></td><td>${d}</td></tr>`).join('')}
      </tbody></table>
      <div class="cap">예시 응답</div>
      <pre>${esc(respJson)}</pre>
    </section>

    <section><h2>코드 예시</h2>
      <div class="cap">curl — 진도 목록</div><pre>${esc(curlMeta)}</pre>
      <div class="cap">curl — 특정 진도 객관식</div><pre>${esc(curlList)}</pre>
      <div class="cap">JavaScript (fetch)</div><pre>${esc(jsCode)}</pre>
      <div class="cap">Python (requests)</div><pre>${esc(pyCode)}</pre>
    </section>

    <section><h2>에러</h2>
      <table><thead><tr><th style="width:14%">상태</th><th>의미</th></tr></thead><tbody>
        <tr><td><code>200</code></td><td>정상 — { ok: true, items: [...] }</td></tr>
        <tr><td><code>401</code></td><td>API 키 없음</td></tr>
        <tr><td><code>403</code></td><td>유효하지 않은 API 키</td></tr>
      </tbody></table>
    </section>

    <section><h2>참고</h2>
      <ul>
        <li><b>CORS</b>: 모든 도메인 허용 — 브라우저에서 바로 호출 가능.</li>
        <li>본문의 <code>&lt;u&gt;…&lt;/u&gt;</code> 는 밑줄. 객관식 <code>answer</code> 가 "③" 이면 <code>options[2]</code> 가 정답입니다.</li>
        <li>반환 대상은 키 소유자가 보유한 문항뿐입니다. 출판 교재 답지 등 내부 자료는 이 API 로 나가지 않습니다.</li>
      </ul>
    </section>
  </body></html>`;

  try {
    const pdf = await renderHtmlToPdf(html);
    const name = encodeURIComponent('라이팅-문제은행-API-문서.pdf');
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${name}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('api-docs pdf:', e);
    return NextResponse.json({ error: 'PDF 생성에 실패했습니다.' }, { status: 500 });
  }
}
