import { NextRequest, NextResponse } from 'next/server';
import { requireVip } from '@/lib/vip-auth';

const NEIS_API_KEY = process.env.NEIS_API_KEY || '6042a36bcfb0479c8733d8f5ed3d0da6';
const NEIS_BASE_URL = 'https://open.neis.go.kr/hub/schoolInfo';

interface NeisSchoolRow {
  ATPT_OFCDC_SC_CODE: string;
  ATPT_OFCDC_SC_NM: string;
  SD_SCHUL_CODE: string;
  SCHUL_NM: string;
  SCHUL_KND_SC_NM: string;
  LCTN_SC_NM: string;
  ORG_RDNMA: string;
  ORG_RDNDA: string;
  FOND_SC_NM: string;
  COEDU_SC_NM: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const query = request.nextUrl.searchParams.get('query') || '';
  const schoolType = request.nextUrl.searchParams.get('type') || '';
  const region = request.nextUrl.searchParams.get('region') || '';

  if (query.length < 2) {
    return NextResponse.json({ schools: [], message: '2글자 이상 입력해주세요.' });
  }

  try {
    const params = new URLSearchParams({
      KEY: NEIS_API_KEY,
      Type: 'json',
      pIndex: '1',
      pSize: '20',
      SCHUL_NM: query,
    });
    if (schoolType) params.set('SCHUL_KND_SC_NM', schoolType);
    if (region) params.set('LCTN_SC_NM', region);

    const res = await fetch(`${NEIS_BASE_URL}?${params}`, { next: { revalidate: 3600 } });
    const data = await res.json();

    if (data.schoolInfo) {
      const rows: NeisSchoolRow[] = data.schoolInfo[1].row;
      const schools = rows.map((row) => ({
        code: row.SD_SCHUL_CODE,
        name: row.SCHUL_NM,
        type: row.SCHUL_KND_SC_NM,
        region: row.LCTN_SC_NM,
        address: `${row.ORG_RDNMA} ${row.ORG_RDNDA}`.trim(),
        officeCode: row.ATPT_OFCDC_SC_CODE,
      }));
      return NextResponse.json({ schools });
    }

    return NextResponse.json({ schools: [] });
  } catch (error) {
    console.error('NEIS API error:', error);
    return NextResponse.json({ error: 'NEIS API 호출 중 오류가 발생했습니다.', schools: [] }, { status: 500 });
  }
}
