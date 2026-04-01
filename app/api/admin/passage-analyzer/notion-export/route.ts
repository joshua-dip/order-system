import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@notionhq/client';
import { requireAdmin } from '@/lib/admin-auth';

function chunkText(s: string, n: number): string[] {
  const t = s.replace(/\s*%%%\s*/g, ' ').trim();
  if (!t) return [];
  const out: string[] = [];
  for (let i = 0; i < t.length; i += n) {
    out.push(t.slice(i, i + n));
  }
  return out.length ? out : [''];
}

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const apiKey = (process.env.NOTION_API_KEY || '').trim();
  const defaultPage = (process.env.NOTION_PAGE_ID || process.env.NOTION_PARENT_PAGE_ID || '').trim();

  try {
    const body = await request.json();
    const pageId = (typeof body.pageId === 'string' && body.pageId.trim()) || defaultPage;
    if (!apiKey || !pageId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'NOTION_API_KEY 및 NOTION_PAGE_ID(또는 요청 body.pageId)가 필요합니다.',
        },
        { status: 503 }
      );
    }

    const {
      title = '지문 분석',
      originalText = '',
      translation = '',
      sentences = [] as string[],
      koreanSentences = [] as string[],
    } = body;

    const notion = new Client({ auth: apiKey });
    const children: Array<Record<string, unknown>> = [
      {
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: String(title).slice(0, 2000) } }],
        },
      },
    ];

    if (originalText) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: '원문' } }] },
      });
      for (const chunk of chunkText(String(originalText), 2000)) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
        });
      }
    }

    if (translation) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: '해석' } }] },
      });
      for (const chunk of chunkText(String(translation), 2000)) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] },
        });
      }
    }

    if (sentences.length > 0) {
      children.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: '한줄해석' } }] },
      });
      sentences.forEach((en: string, i: number) => {
        const ko = koreanSentences[i] || '';
        const line = `${i + 1}. ${en}${ko ? `\n   ${ko}` : ''}`.slice(0, 2000);
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
        });
      });
    }

    const batchSize = 100;
    for (let i = 0; i < children.length; i += batchSize) {
      await notion.blocks.children.append({
        block_id: pageId,
        children: children.slice(i, i + batchSize) as Parameters<
          typeof notion.blocks.children.append
        >[0]['children'],
      });
    }

    return NextResponse.json({ success: true, message: 'Notion에 블록을 추가했습니다.' });
  } catch (e) {
    console.error('notion-export:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
