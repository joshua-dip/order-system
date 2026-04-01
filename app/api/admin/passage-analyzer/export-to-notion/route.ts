import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@notionhq/client';
import { requireAdmin } from '@/lib/admin-auth';

/** 하위 페이지 생성 대신 부모 페이지에 블록 추가 (스키마 의존 제거) */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const apiKey = (process.env.NOTION_API_KEY || '').trim();
  const defaultPage = (process.env.NOTION_PAGE_ID || process.env.NOTION_PARENT_PAGE_ID || '').trim();

  try {
    const body = await request.json();
    const pageId =
      (typeof body.parentPageId === 'string' && body.parentPageId.trim()) || defaultPage;
    const title =
      (typeof body.fileName === 'string'
        ? body.fileName.replace(/\.(xlsx|json)$/i, '')
        : '지문') || '지문';
    const passage = typeof body.passage === 'string' ? body.passage : '';
    const translation = typeof body.translation === 'string' ? body.translation : '';

    if (!apiKey || !pageId) {
      return NextResponse.json(
        { error: 'NOTION_API_KEY 및 NOTION_PAGE_ID(또는 parentPageId)가 필요합니다.' },
        { status: 503 }
      );
    }

    const notion = new Client({ auth: apiKey });
    const children: Array<Record<string, unknown>> = [
      {
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: title.slice(0, 2000) } }],
        },
      },
    ];
    if (passage) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: passage.slice(0, 2000) } }],
        },
      });
    }
    if (translation) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `해석: ${translation.slice(0, 1900)}` } }],
        },
      });
    }

    await notion.blocks.children.append({
      block_id: pageId,
      children: children as Parameters<typeof notion.blocks.children.append>[0]['children'],
    });

    return NextResponse.json({ success: true, pageId });
  } catch (e) {
    console.error('export-to-notion:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : '실패' }, { status: 500 });
  }
}
