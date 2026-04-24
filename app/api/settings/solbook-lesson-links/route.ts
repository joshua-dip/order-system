import { NextResponse } from 'next/server';
import { getSolbookLinksMap } from '@/lib/solbook-lesson-links-store';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate' };

export async function GET() {
  try {
    const map = await getSolbookLinksMap();
    return NextResponse.json({ map }, { headers: NO_STORE });
  } catch (e) {
    console.error('solbook-lesson-links GET:', e);
    return NextResponse.json({ map: {} }, { headers: NO_STORE });
  }
}
