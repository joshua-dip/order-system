import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVip } from '@/lib/vip-auth';
import { getVipDb, col } from '@/lib/vip-db';
import { getDb } from '@/lib/mongodb';

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

  if (!scopeExamId) {
    return NextResponse.json({ error: 'scopeExamId가 필요합니다.' }, { status: 400 });
  }

  const vipDb = await getVipDb();
  const uid = new ObjectId(auth.userId);
  const db = await getDb('gomijoshua');

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
  const psKeys: string[] = [];
  for (const p of passageDocs) {
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
    for (const { sourceKey } of entries) {
      const ps = passageSourceLookup.get(`${tb}::${sourceKey}`);
      if (ps) {
        const origId = passageSourceToId.get(ps);
        if (origId) {
          passageIdSet.add(origId);
          if (!passageIdsByTb.has(tb)) passageIdsByTb.set(tb, []);
          passageIdsByTb.get(tb)!.push(origId);
        }
      } else normal.push(sourceKey);
    }
    if (normal.length > 0) { if (!normalSrcMap.has(tb)) normalSrcMap.set(tb, []); normalSrcMap.get(tb)!.push(...normal); }
  }

  // 교재별 textbookCounts 파싱
  let textbookCountsParam: Record<string, number> = {};
  const tcStr = sp.get('textbookCounts');
  if (tcStr) { try { textbookCountsParam = JSON.parse(tcStr); } catch { /* 무시 */ } }
  const perTbMode = Object.keys(textbookCountsParam).length > 1;

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
    if (typeFilter) f.type = typeFilter;
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
    if (typeFilter) scopeFilter.type = typeFilter;
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
    return { id: (q._id as ObjectId).toString(), textbook: q.textbook, passageId: q.passage_id ? (q.passage_id as ObjectId).toString() : null, type: q.type, difficulty: q.difficulty, paragraph: qd.Paragraph ?? '', options: qd.Options ?? '', answer: qd.Answer ?? '', explanation: qd.Explanation ?? '', source: qd.Source ?? '', pric: q.pric ?? null };
  };

  // 4) N세트 비중복 생성
  const resultSets: ReturnType<typeof mapQ>[][] = [];
  const globalUsedIds = new Set<string>();

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
    const excludeOids = [...globalUsedIds].map((h) => new ObjectId(h));
    const setQuestions: Record<string, unknown>[] = [];

    if (perTbMode) {
      // ── 교재별 문제 수 지정 모드 ──
      for (const [tb, tbTotal] of Object.entries(textbookCountsParam)) {
        if (tbTotal <= 0) continue;
        if (hasTypeFilter) {
          // 유형 분포를 교재 할당량 안에서 비례 배분
          const tbTypeCounts = distributeTypes(typeCounts, tbTotal);
          for (const [type, share] of Object.entries(tbTypeCounts)) {
            if (share <= 0) continue;
            const filter = buildTbFilter(tb, type, excludeOids);
            if (!filter) continue;
            const qs = random
              ? await db.collection('generated_questions').aggregate([{ $match: filter }, { $sample: { size: share } }, { $project: project }]).toArray()
              : await db.collection('generated_questions').find(filter).project(project).limit(share).toArray();
            setQuestions.push(...qs);
            for (const q of qs) globalUsedIds.add((q._id as ObjectId).toHexString());
          }
        } else {
          const filter = buildTbFilter(tb, undefined, excludeOids);
          if (!filter) continue;
          const qs = random
            ? await db.collection('generated_questions').aggregate([{ $match: filter }, { $sample: { size: tbTotal } }, { $project: project }]).toArray()
            : await db.collection('generated_questions').find(filter).project(project).limit(tbTotal).toArray();
          setQuestions.push(...qs);
          for (const q of qs) globalUsedIds.add((q._id as ObjectId).toHexString());
        }
      }
      if (random) shuffle(setQuestions);
    } else if (hasTypeFilter) {
      // ── 유형별 fetch 모드 ──
      for (const [type, count] of Object.entries(typeCounts)) {
        if (count <= 0) continue;
        const filter = buildFilter(type, excludeOids);
        const qs = random
          ? await db.collection('generated_questions').aggregate([{ $match: filter }, { $sample: { size: count } }, { $project: project }]).toArray()
          : await db.collection('generated_questions').find(filter).project(project).limit(count).toArray();
        setQuestions.push(...qs);
        for (const q of qs) globalUsedIds.add((q._id as ObjectId).toHexString());
      }
      if (random) shuffle(setQuestions);
    } else {
      // ── 전체 범위 fetch 모드 ──
      const filter = buildFilter(undefined, excludeOids);
      const qs = random
        ? await db.collection('generated_questions').aggregate([{ $match: filter }, { $sample: { size: total } }, { $project: project }]).toArray()
        : await db.collection('generated_questions').find(filter).project(project).limit(total).toArray();
      setQuestions.push(...qs);
      for (const q of qs) globalUsedIds.add((q._id as ObjectId).toHexString());
    }

    // 부족분 보충 (perTbMode가 아닐 때만)
    if (!perTbMode && setQuestions.length < total) {
      const setUsedIds = new Set(setQuestions.map((q) => (q._id as ObjectId).toHexString()));
      const fallbackExclude = [...new Set([...globalUsedIds, ...setUsedIds])].map((h) => new ObjectId(h));
      const need = total - setQuestions.length;
      const filter = buildFilter(undefined, fallbackExclude);
      const extra = random
        ? await db.collection('generated_questions').aggregate([{ $match: filter }, { $sample: { size: need } }, { $project: project }]).toArray()
        : await db.collection('generated_questions').find(filter).project(project).limit(need).toArray();
      setQuestions.push(...extra);
      for (const q of extra) globalUsedIds.add((q._id as ObjectId).toHexString());
      if (random) shuffle(setQuestions);
    }

    resultSets.push(setQuestions.map(mapQ));
  }

  return NextResponse.json({ ok: true, sets: resultSets, typeCounts });
}
