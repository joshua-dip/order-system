import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { hasAnnualMemberMenuAccess } from '@/lib/premium-member';
import { isMockExamPassageTextbookStored } from '@/lib/member-variant-passage-sources';

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '인증 필요' }, { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증 만료' }, { status: 401 });

  const db = await getDb('gomijoshua');
  const user = await db.collection('users').findOne(
    { _id: new ObjectId(payload.sub) },
    { projection: { annualMemberSince: 1, signupPremiumTrialUntil: 1 } },
  );
  const since = (user as { annualMemberSince?: Date } | null)?.annualMemberSince;
  const trialUntil = (user as { signupPremiumTrialUntil?: Date } | null)?.signupPremiumTrialUntil;
  if (!user || !hasAnnualMemberMenuAccess({ annualSince: since ?? null, signupPremiumTrialUntil: trialUntil ?? null })) {
    return NextResponse.json({ error: '연회원 전용' }, { status: 403 });
  }

  const analyses = db.collection('passage_analyses');
  const fileNames: { fileName: string }[] = await analyses
    .find(
      { 'passageStates.main.vocabularyList.0': { $exists: true } },
      { projection: { fileName: 1 } },
    )
    .toArray() as any;

  const passageIds = fileNames
    .map((f) => f.fileName)
    .filter((fn) => fn?.startsWith('passage:'))
    .map((fn) => fn.replace('passage:', ''));

  const objectIds = passageIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (objectIds.length === 0) return NextResponse.json({ textbooks: [], lessonMap: {} });

  const passages = await db
    .collection('passages')
    .find({ _id: { $in: objectIds } })
    .project({ textbook: 1, chapter: 1, number: 1, order: 1 })
    .toArray();

  const tbSet = new Set<string>();
  const lessonMap: Record<string, Record<string, string[]>> = {};

  for (const p of passages) {
    const tb = typeof p.textbook === 'string' ? p.textbook.trim() : '';
    if (!tb || !isMockExamPassageTextbookStored(tb)) continue;
    tbSet.add(tb);

    if (!lessonMap[tb]) lessonMap[tb] = {};
    const chapter = (p.chapter as string) || '';
    const number = (p.number as string) || '';

    const isMockExam = chapter === tb;
    const key = isMockExam ? '전체' : chapter;
    const label = isMockExam ? number : `${chapter} ${number}`.trim();

    if (!lessonMap[tb][key]) lessonMap[tb][key] = [];
    if (label && !lessonMap[tb][key].includes(label)) {
      lessonMap[tb][key].push(label);
    }
  }

  for (const tb of Object.keys(lessonMap)) {
    for (const ch of Object.keys(lessonMap[tb])) {
      lessonMap[tb][ch].sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, '')) || 0;
        const numB = parseInt(b.replace(/\D/g, '')) || 0;
        return numA - numB;
      });
    }
  }

  const textbooks = Array.from(tbSet).sort();

  return NextResponse.json({ textbooks, lessonMap });
}
