import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col } from '@/lib/vip-db';
import { getDb } from '@/lib/mongodb';
import { expandVariantTypes } from '@/lib/book-variant-types';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const sp = request.nextUrl.searchParams;
  const scopeExamId = sp.get('scopeExamId');
  const patternExamId = sp.get('patternExamId');
  const typeCountsStr = sp.get('typeCounts');
  const total = Math.min(100, Math.max(1, Number(sp.get('total') || '20')));
  const random = sp.get('random') !== 'false';
  const setsCount = Math.min(5, Math.max(1, Number(sp.get('sets') || '1')));
  /** 기출 시험지의 문항(지문·유형) 순서대로 생성 */
  const followOrder = sp.get('followOrder') === 'true';

  if (!scopeExamId) {
    return NextResponse.json({ error: 'scopeExamId가 필요합니다.' }, { status: 400 });
  }

  const vipDb = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const db = await getDb('gomijoshua');

  // 교재 → 카테고리 분류 (admin/passages 설정 + 모의고사 이름 패턴)
  // 표지 출처 분포가 "어느 범위 교재에서 뽑았는지"로 집계되도록 문항에 scope 카테고리를 태깅한다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typeMetaDoc = await db.collection('settings').findOne({ _id: 'textbookTypeMeta' } as any);
  const catMap = (typeMetaDoc?.value && typeof typeMetaDoc.value === 'object') ? (typeMetaDoc.value as Record<string, string>) : {};
  const MOCK = /^\d{2}년\s+\d{1,2}월\s+고[123]\s+영어모의고사|^\d{2}년\s+고[123]\s+영어모의고사/;
  const classifyScope = (tb: string): string => {
    const t = catMap[tb];
    if (t === '교과서' || t === '부교재' || t === '모의고사') return t;
    return MOCK.test(tb) || /영어모의고사$/.test(tb) ? '모의고사' : '부교재';
  };

  // 1) 시험 범위 로드
  const scopeExam = await col(vipDb, 'schoolExams').findOne({ _id: new ObjectId(scopeExamId), userId: uid });
  if (!scopeExam) return NextResponse.json({ error: '시험 범위 데이터를 찾을 수 없습니다.' }, { status: 404 });

  const examScope: string[] = (scopeExam.examScope as string[]) ?? [];
  const examScopePassages: string[] = ((scopeExam as Record<string, unknown>).examScopePassages as string[]) ?? [];

  // 2) 유형 분포 계산
  let typeCounts: Record<string, number> = {};
  if (typeCountsStr) { try { typeCounts = JSON.parse(typeCountsStr); } catch { /* 무시 */ } }

  if (Object.keys(typeCounts).length === 0 && patternExamId) {
    const patternExam = await col(vipDb, 'schoolExams').findOne({ _id: new ObjectId(patternExamId), userId: uid });
    if (patternExam?.questions) {
      const rawObj: Record<string, number> = {};
      let subjectiveCount = 0;
      for (const q of Object.values(patternExam.questions as Record<string, { isSubjective?: boolean; questionType?: string }>)) {
        if (q.isSubjective || q.questionType === '서술형') { subjectiveCount++; }
        else if (q.questionType) rawObj[q.questionType] = (rawObj[q.questionType] ?? 0) + 1;
      }
      const rawTotal = Object.values(rawObj).reduce((s, v) => s + v, 0);
      if (rawTotal > 0) {
        for (const [type, count] of Object.entries(rawObj)) {
          typeCounts[type] = Math.max(1, Math.round((count / rawTotal) * total));
        }
        const scaled = Object.values(typeCounts).reduce((s, v) => s + v, 0);
        const diff = total - scaled;
        if (diff !== 0) {
          const largest = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
          if (largest) typeCounts[largest[0]] = Math.max(0, typeCounts[largest[0]] + diff);
        }
      }
      // 서술형은 기출 실제 수 그대로
      if (subjectiveCount > 0) typeCounts['서술형'] = subjectiveCount;
    }
  }

  const hasTypeFilter = Object.keys(typeCounts).length > 0;

  // 3) 범위 → DB 필터 조건 변환
  type ScopeEntry = { textbook: string; sourceKey: string };
  const scopeByTextbook = new Map<string, ScopeEntry[]>();
  if (examScopePassages.length > 0) {
    for (const entry of examScopePassages) {
      const sep = entry.indexOf('::');
      if (sep < 0) continue;
      const tb = entry.slice(0, sep);
      const sk = entry.slice(sep + 2);
      if (!scopeByTextbook.has(tb)) scopeByTextbook.set(tb, []);
      scopeByTextbook.get(tb)!.push({ textbook: tb, sourceKey: sk });
    }
  } else {
    for (const tb of examScope) scopeByTextbook.set(tb, []);
  }

  if (scopeByTextbook.size === 0) {
    return NextResponse.json({ ok: true, sets: [], typeCounts, scopeEmpty: true });
  }

  // 3a) passage_source 기반 교재 처리
  const allSourceKeys = [...scopeByTextbook.values()].flat().map((e) => e.sourceKey);
  const allTextbooks = [...scopeByTextbook.keys()];

  const passageDocs = allSourceKeys.length > 0
    ? await db.collection('passages').find({ textbook: { $in: allTextbooks }, source_key: { $in: allSourceKeys } }, { projection: { _id: 1, textbook: 1, source_key: 1, passage_source: 1 } }).toArray()
    : [];

  const passageSourceLookup = new Map<string, string>();
  const ownIdByKey = new Map<string, string>(); // 교재::source_key → 그 지문 자신의 passage_id
  const psKeys: string[] = [];
  for (const p of passageDocs) {
    ownIdByKey.set(`${p.textbook}::${p.source_key}`, String(p._id));
    const ps = String((p as Record<string, unknown>).passage_source ?? '').trim();
    if (ps) { passageSourceLookup.set(`${p.textbook}::${p.source_key}`, ps); psKeys.push(ps); }
  }

  const passageSourceToId = new Map<string, string>();
  if (psKeys.length > 0) {
    const origDocs = await db.collection('passages').find({ source_key: { $in: psKeys } }, { projection: { _id: 1, source_key: 1 } }).toArray();
    for (const op of origDocs) passageSourceToId.set(String(op.source_key), (op._id as ObjectId).toHexString());
  }

  const passageIdSet = new Set<string>();
  const passageIdsByTb = new Map<string, string[]>(); // 교재별 passage_id 목록
  const normalSrcMap = new Map<string, string[]>();
  const noSourceTextbooks: string[] = [];

  for (const [tb, entries] of scopeByTextbook) {
    if (entries.length === 0) { noSourceTextbooks.push(tb); continue; }
    const normal: string[] = [];
    const addPid = (hex: string) => {
      passageIdSet.add(hex);
      if (!passageIdsByTb.has(tb)) passageIdsByTb.set(tb, []);
      passageIdsByTb.get(tb)!.push(hex);
    };
    for (const { sourceKey } of entries) {
      const key = `${tb}::${sourceKey}`;
      const ownId = ownIdByKey.get(key);
      // 지문 자신의 변형문항을 항상 후보로 (올림포스처럼 passage_source 가 있어도 자기 변형이 누락되지 않게)
      if (ownId) addPid(ownId);
      const ps = passageSourceLookup.get(key);
      if (ps) {
        const origId = passageSourceToId.get(ps);
        if (origId) addPid(origId); // 원본(모의고사) 변형도 재사용 후보로
      } else if (!ownId) {
        normal.push(sourceKey); // 지문 자체를 못 찾았을 때만 Source 매칭 폴백
      }
    }
    if (normal.length > 0) { if (!normalSrcMap.has(tb)) normalSrcMap.set(tb, []); normalSrcMap.get(tb)!.push(...normal); }
  }

  // 교재별 textbookCounts 파싱
  let textbookCountsParam: Record<string, number> = {};
  const tcStr = sp.get('textbookCounts');
  if (tcStr) { try { textbookCountsParam = JSON.parse(tcStr); } catch { /* 무시 */ } }
  const perTbMode = Object.keys(textbookCountsParam).length > 1;

  // 지문별 유형 고정 — { "교재::source_key": "유형" }. 해당 지문은 무조건 그 유형 1문항으로 출제.
  // (한 시험지 안에서 같은 지문은 재사용 안 되므로 '이 지문은 이 유형으로만' 과 동치)
  const passagePins: { tb: string; sourceKey: string; type: string }[] = [];
  const ppStr = sp.get('passagePins');
  if (ppStr) {
    try {
      const obj = JSON.parse(ppStr) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        const t = String(v ?? '').trim();
        const sep = k.indexOf('::');
        if (t && t !== '자동' && sep > 0) passagePins.push({ tb: k.slice(0, sep), sourceKey: k.slice(sep + 2), type: t });
      }
    } catch { /* 무시 */ }
  }

  /** 고정 지문(교재::source_key) → 그 지문의 후보 passage_id 목록 (자기 변형 + passage_source 원본). */
  const resolvePinPids = (tb: string, sourceKey: string): ObjectId[] => {
    const key = `${tb}::${sourceKey}`;
    const hexes: string[] = [];
    const ownId = ownIdByKey.get(key); if (ownId) hexes.push(ownId);
    const ps = passageSourceLookup.get(key);
    if (ps) { const o = passageSourceToId.get(ps); if (o) hexes.push(o); }
    return [...new Set(hexes)].map((h) => new ObjectId(h));
  };

  /** 고정 지문에서 유형(별칭·고난도 폴백) 1문항 샘플 — used(전역 사용)·status 완료 준수. */
  const placeOnePin = async (
    pin: { tb: string; sourceKey: string; type: string },
    used: Set<string>,
  ): Promise<Record<string, unknown> | null> => {
    const pids = resolvePinPids(pin.tb, pin.sourceKey);
    if (pids.length === 0) return null;
    const exclude = [...used].map((h) => new ObjectId(h));
    // 정확한 지정 유형 우선 → 없으면 별칭·고난도까지 확장
    for (const types of [[pin.type], expandVariantTypes(pin.type)]) {
      const match: Record<string, unknown> = { status: '완료', passage_id: { $in: pids }, type: { $in: types } };
      if (exclude.length > 0) match._id = { $nin: exclude };
      const res = await db.collection('generated_questions')
        .aggregate([{ $match: match }, { $sample: { size: 1 } }, { $project: project }]).toArray();
      if (res[0]) { const q = res[0] as Record<string, unknown>; q._scopeCat = classifyScope(pin.tb); return q; }
    }
    return null;
  };

  // 교재 단위 필터 빌더 (per-textbook fetch용)
  const buildTbFilter = (tb: string, typeFilter?: string, excludeIds: ObjectId[] = []): Record<string, unknown> | null => {
    const conditions: Record<string, unknown>[] = [];
    const srcs = normalSrcMap.get(tb);
    if (srcs?.length) conditions.push({ textbook: tb, 'question_data.Source': { $in: srcs } });
    const pids = passageIdsByTb.get(tb);
    if (pids?.length) conditions.push({ passage_id: { $in: pids.map((h) => new ObjectId(h)) } });
    if (noSourceTextbooks.includes(tb)) conditions.push({ textbook: tb });
    if (conditions.length === 0) return null;
    const f: Record<string, unknown> = { status: '완료' };
    // 유형은 별칭 정규화(내용일치→일치) + 고난도형까지 후보에 포함
    if (typeFilter) f.type = { $in: expandVariantTypes(typeFilter) };
    if (conditions.length === 1) Object.assign(f, conditions[0]);
    else f.$or = conditions;
    if (excludeIds.length === 0) return f;
    return { $and: [f, { _id: { $nin: excludeIds } }] };
  };

  // 전체 범위 필터 빌더 (excludeIds 포함)
  const buildFilter = (typeFilter?: string, excludeIds: ObjectId[] = []): Record<string, unknown> => {
    const scopeConditions: Record<string, unknown>[] = [];
    if (passageIdSet.size > 0) scopeConditions.push({ passage_id: { $in: [...passageIdSet].map((h) => new ObjectId(h)) } });
    for (const [tb, srcs] of normalSrcMap) scopeConditions.push({ textbook: tb, 'question_data.Source': { $in: srcs } });
    for (const tb of noSourceTextbooks) scopeConditions.push({ textbook: tb });
    if (scopeConditions.length === 0) return { _id: new ObjectId() }; // 빈 결과 보장

    const scopeFilter: Record<string, unknown> = { status: '완료' };
    if (typeFilter) scopeFilter.type = { $in: expandVariantTypes(typeFilter) };
    if (scopeConditions.length === 1) Object.assign(scopeFilter, scopeConditions[0]);
    else scopeFilter.$or = scopeConditions;

    if (excludeIds.length === 0) return scopeFilter;
    return { $and: [scopeFilter, { _id: { $nin: excludeIds } }] };
  };

  const project = {
    textbook: 1, passage_id: 1, type: 1, difficulty: 1,
    'question_data.Paragraph': 1, 'question_data.Options': 1,
    'question_data.Answer': 1, 'question_data.Explanation': 1, 'question_data.Source': 1, pric: 1,
  };

  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const mapQ = (q: Record<string, unknown>) => {
    const qd = (q.question_data as Record<string, unknown>) ?? {};
    // _scopeCat: 어느 범위(scope) 교재 카테고리에서 뽑혔는지(태깅). 없으면 문항 textbook으로 분류.
    const scopeCategory = (typeof q._scopeCat === 'string' && q._scopeCat) ? q._scopeCat : classifyScope(String(q.textbook ?? ''));
    return { id: (q._id as ObjectId).toString(), textbook: q.textbook, passageId: q.passage_id ? (q.passage_id as ObjectId).toString() : null, type: q.type, difficulty: q.difficulty, paragraph: qd.Paragraph ?? '', options: qd.Options ?? '', answer: qd.Answer ?? '', explanation: qd.Explanation ?? '', source: qd.Source ?? '', pric: q.pric ?? null, scopeCategory };
  };

  /**
   * filter 에서 count 개를 '지문 우선 비중복'으로 선택 (시험지처럼 같은 지문 안 겹치게).
   *  - setPassages 에 없는 지문에서 먼저 한 개씩 → 한 시험지(set) 안에서 지문 안 겹침.
   *  - 후보 지문이 문항 수보다 적을 때만 같은 지문 재사용(불가피).
   * 경량 (_id, passage_id) 전수 조회로 모든 지문을 보게 해 비중복을 보장한다.
   */
  const pickDistinctPassages = async (
    baseFilter: Record<string, unknown>,
    count: number,
    setPassages: Set<string>,
  ): Promise<Record<string, unknown>[]> => {
    if (count <= 0) return [];
    const lite = await db.collection('generated_questions')
      .find(baseFilter).project({ _id: 1, passage_id: 1 }).limit(5000).toArray();
    if (lite.length === 0) return [];
    if (random) shuffle(lite);
    const chosen: ObjectId[] = [];
    const reuse: ObjectId[] = [];
    for (const q of lite) {
      if (chosen.length >= count) break;
      const pid = q.passage_id ? String(q.passage_id) : `__nopid_${String(q._id)}`;
      if (setPassages.has(pid)) { reuse.push(q._id as ObjectId); continue; }
      chosen.push(q._id as ObjectId); setPassages.add(pid);
    }
    for (const id of reuse) { if (chosen.length >= count) break; chosen.push(id); } // 지문 부족 시 재사용
    if (chosen.length === 0) return [];
    const docs = await db.collection('generated_questions')
      .find({ _id: { $in: chosen } }).project(project).toArray();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    return chosen.map((id) => byId.get(String(id))).filter((d): d is Record<string, unknown> => !!d);
  };

  // 4) N세트 비중복 생성
  const resultSets: ReturnType<typeof mapQ>[][] = [];
  const globalUsedIds = new Set<string>();

  // ── 기출 순서 따르기: 기출 시험지의 문항(지문·유형) 순서대로 1문항씩 매칭 ──
  if (followOrder && patternExamId) {
    const patternExam = await col(vipDb, 'schoolExams').findOne({ _id: new ObjectId(patternExamId), userId: uid });
    const patternQuestions = (patternExam?.questions ?? {}) as Record<string, { questionType?: string; isSubjective?: boolean; textbook?: string }>;
    if (Object.keys(patternQuestions).length > 0) {
      const scopeTbs = [...scopeByTextbook.keys()];
      const scopeByCat: Record<string, string[]> = {};
      for (const tb of scopeTbs) (scopeByCat[classifyScope(tb)] ||= []).push(tb);

      // 패턴 문항 순서 (서술형 제외 — 변형 객관식만 생성됨)
      const orderedPattern = Object.entries(patternQuestions)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, q]) => q)
        .filter((q) => !(q.isSubjective || q.questionType === '서술형'));

      // 후보 교재 + 유형 → 1문항 무작위 샘플 (중복 문항 제외 + avoidPassages 면 이미 쓴 지문도 제외)
      const sampleOne = async (tbs: string[], typeFilter: string | undefined, used: Set<string>, avoidPassages: Set<string> | null) => {
        const exOids = [...used].map((h) => new ObjectId(h));
        const conds = tbs.map((tb) => buildTbFilter(tb, typeFilter, exOids)).filter((f): f is Record<string, unknown> => !!f);
        if (conds.length === 0) return null;
        let filter: Record<string, unknown> = conds.length === 1 ? conds[0] : { $or: conds };
        if (avoidPassages && avoidPassages.size > 0) {
          const pidOids = [...avoidPassages].filter((p) => !p.startsWith('__') && ObjectId.isValid(p)).map((p) => new ObjectId(p));
          if (pidOids.length > 0) filter = { $and: [filter, { passage_id: { $nin: pidOids } }] };
        }
        const res = await db.collection('generated_questions')
          .aggregate([{ $match: filter }, { $sample: { size: 1 } }, { $project: project }]).toArray();
        return res[0] ?? null;
      };

      for (let s = 0; s < setsCount; s++) {
        const setQuestions: Record<string, unknown>[] = [];
        const setPassages = new Set<string>(); // 이 시험지(set)에서 이미 쓴 지문 — 겹침 방지
        const remainingPins = [...passagePins]; // 이 슬롯들에 우선 배치할 고정 지문
        for (const pq of orderedPattern) {
          const type = pq.questionType;
          const refTb = pq.textbook?.trim();
          const cat = refTb ? classifyScope(refTb) : null;
          // 고정 지문 우선: 이 슬롯 교재(또는 같은 카테고리)에 고정 지문이 있으면 그 지문을 지정 유형으로 배치
          if (remainingPins.length > 0) {
            let pinIdx = refTb ? remainingPins.findIndex((p) => p.tb === refTb) : -1;
            if (pinIdx < 0 && cat) pinIdx = remainingPins.findIndex((p) => classifyScope(p.tb) === cat);
            if (pinIdx >= 0) {
              const pinned = await placeOnePin(remainingPins[pinIdx], globalUsedIds);
              if (pinned) {
                setQuestions.push(pinned);
                globalUsedIds.add((pinned._id as ObjectId).toHexString());
                if (pinned.passage_id) setPassages.add(String(pinned.passage_id));
                remainingPins.splice(pinIdx, 1);
                continue;
              }
            }
          }
          // 후보: 기출과 동일 교재(범위에 있으면) → 같은 카테고리 범위 교재 → 전체 범위
          let candidates: string[];
          if (refTb && scopeByTextbook.has(refTb)) candidates = [refTb];
          else if (cat && scopeByCat[cat]?.length) candidates = scopeByCat[cat];
          else candidates = scopeTbs;
          // 같은 후보+유형 → 후보 아무유형 → 전체+유형 → 전체 아무거나
          const tryChain = async (avoid: Set<string> | null) => {
            let p = await sampleOne(candidates, type, globalUsedIds, avoid);
            if (!p) p = await sampleOne(candidates, undefined, globalUsedIds, avoid);
            if (!p && type) p = await sampleOne(scopeTbs, type, globalUsedIds, avoid);
            if (!p) p = await sampleOne(scopeTbs, undefined, globalUsedIds, avoid);
            return p;
          };
          // 1차: 지문 안 겹치게 → 부족하면(2차) 같은 지문 재사용 허용
          let picked = await tryChain(setPassages);
          if (!picked) picked = await tryChain(null);
          if (picked) {
            // 어느 카테고리에서 뽑았는지 태깅(올림포스처럼 passage_source로 원본 교재가 모의고사여도 범위 기준으로 집계)
            picked._scopeCat = cat ?? classifyScope(String(picked.textbook ?? ''));
            setQuestions.push(picked);
            globalUsedIds.add((picked._id as ObjectId).toHexString());
            if (picked.passage_id) setPassages.add(String(picked.passage_id));
          }
        }
        // 패턴 슬롯에 못 들어간 고정 지문은 끝에 덧붙임
        for (const pin of remainingPins) {
          const pinned = await placeOnePin(pin, globalUsedIds);
          if (pinned) {
            setQuestions.push(pinned);
            globalUsedIds.add((pinned._id as ObjectId).toHexString());
            if (pinned.passage_id) setPassages.add(String(pinned.passage_id));
          }
        }
        resultSets.push(setQuestions.map(mapQ));
      }
      return NextResponse.json({ ok: true, sets: resultSets, typeCounts, followedOrder: true });
    }
  }

  // 유형 비율을 tbTotal에 맞게 분배
  const distributeTypes = (counts: Record<string, number>, tbTotal: number): Record<string, number> => {
    const typeTotal = Object.values(counts).reduce((s, v) => s + v, 0);
    if (typeTotal === 0) return {};
    const result: Record<string, number> = {};
    let remaining = tbTotal;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([type, cnt], i) => {
      if (i === sorted.length - 1) { result[type] = Math.max(0, remaining); }
      else { const share = Math.max(0, Math.round(cnt / typeTotal * tbTotal)); result[type] = share; remaining -= share; }
    });
    return result;
  };

  for (let s = 0; s < setsCount; s++) {
    const setQuestions: Record<string, unknown>[] = [];
    const setPassages = new Set<string>(); // 이 시험지(set)에서 이미 쓴 지문 — 겹침 방지

    // ── 지문별 유형 고정 — 이 세트에서 먼저 강제 배치 ──
    const pinnedThisSet: { tb: string; vtype: string }[] = [];
    for (const pin of passagePins) {
      const pinned = await placeOnePin(pin, globalUsedIds);
      if (pinned) {
        setQuestions.push(pinned);
        globalUsedIds.add((pinned._id as ObjectId).toHexString());
        if (pinned.passage_id) setPassages.add(String(pinned.passage_id));
        pinnedThisSet.push({ tb: pin.tb, vtype: String(pinned.type) });
      }
    }
    // 고정으로 채운 만큼 유형·교재 목표치에서 차감(총 문항수 유지)
    const adjTypeCounts: Record<string, number> = { ...typeCounts };
    for (const { vtype } of pinnedThisSet) {
      const key = Object.keys(adjTypeCounts).find((k) => adjTypeCounts[k] > 0 && expandVariantTypes(k).includes(vtype));
      if (key) adjTypeCounts[key] = Math.max(0, adjTypeCounts[key] - 1);
    }
    const adjTbCounts: Record<string, number> = { ...textbookCountsParam };
    for (const { tb } of pinnedThisSet) { if (adjTbCounts[tb] != null) adjTbCounts[tb] = Math.max(0, adjTbCounts[tb] - 1); }

    const excludeOids = [...globalUsedIds].map((h) => new ObjectId(h));

    if (perTbMode) {
      // ── 교재별 문제 수 지정 모드 ──
      for (const [tb, tbTotal] of Object.entries(adjTbCounts)) {
        if (tbTotal <= 0) continue;
        if (hasTypeFilter) {
          // 유형 분포를 교재 할당량 안에서 비례 배분
          const tbTypeCounts = distributeTypes(adjTypeCounts, tbTotal);
          for (const [type, share] of Object.entries(tbTypeCounts)) {
            if (share <= 0) continue;
            const filter = buildTbFilter(tb, type, excludeOids);
            if (!filter) continue;
            const qs = await pickDistinctPassages(filter, share, setPassages);
            for (const q of qs) { (q as Record<string, unknown>)._scopeCat = classifyScope(tb); globalUsedIds.add((q._id as ObjectId).toHexString()); }
            setQuestions.push(...qs);
          }
        } else {
          const filter = buildTbFilter(tb, undefined, excludeOids);
          if (!filter) continue;
          const qs = await pickDistinctPassages(filter, tbTotal, setPassages);
          for (const q of qs) { (q as Record<string, unknown>)._scopeCat = classifyScope(tb); globalUsedIds.add((q._id as ObjectId).toHexString()); }
          setQuestions.push(...qs);
        }
      }
      if (random) shuffle(setQuestions);
    } else if (hasTypeFilter) {
      // ── 유형별 fetch 모드 ──
      for (const [type, count] of Object.entries(adjTypeCounts)) {
        if (count <= 0) continue;
        const filter = buildFilter(type, excludeOids);
        const qs = await pickDistinctPassages(filter, count, setPassages);
        setQuestions.push(...qs);
        for (const q of qs) globalUsedIds.add((q._id as ObjectId).toHexString());
      }
      if (random) shuffle(setQuestions);
    } else {
      // ── 전체 범위 fetch 모드 ──
      const filter = buildFilter(undefined, excludeOids);
      const qs = await pickDistinctPassages(filter, Math.max(0, total - setQuestions.length), setPassages);
      setQuestions.push(...qs);
      for (const q of qs) globalUsedIds.add((q._id as ObjectId).toHexString());
    }

    // 부족분 보충 — 특정 교재의 문항이 부족해 목표 수에 못 미치면 범위 전체에서 채움(실제 시험처럼 꽉 채우기).
    if (setQuestions.length < total) {
      const setUsedIds = new Set(setQuestions.map((q) => (q._id as ObjectId).toHexString()));
      const fallbackExclude = [...new Set([...globalUsedIds, ...setUsedIds])].map((h) => new ObjectId(h));
      const need = total - setQuestions.length;
      const filter = buildFilter(undefined, fallbackExclude);
      const extra = await pickDistinctPassages(filter, need, setPassages); // 보충도 같은 지문 안 겹치게
      setQuestions.push(...extra);
      for (const q of extra) globalUsedIds.add((q._id as ObjectId).toHexString());
      if (random) shuffle(setQuestions);
    }

    resultSets.push(setQuestions.map(mapQ));
  }

  return NextResponse.json({ ok: true, sets: resultSets, typeCounts });
}
