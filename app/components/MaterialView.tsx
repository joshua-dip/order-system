'use client';

import { parseRows, type MaterialBlock, type MaterialType } from '@/lib/material-types';

export interface MaterialDoc {
  type: MaterialType;
  title: string;
  grade?: string;
  subtitle?: string;
  blocks: MaterialBlock[];
}

/** 교재를 "종이"처럼 렌더 (흰 배경·검정 글씨) — 편집 미리보기·인쇄 뷰 공용. */
export default function MaterialView({ material, showAnswers = true }: { material: MaterialDoc; showAnswers?: boolean }) {
  return (
    <div className="material-paper text-[#1a1a1a] leading-relaxed">
      {/* 표지 헤더 */}
      <header className="mb-6 pb-4 border-b-2 border-[#1a1a1a]">
        <div className="flex items-center gap-2 mb-1 text-[12px] text-[#555]">
          <span className="px-2 py-0.5 rounded bg-[#eee] border border-[#ccc]">{material.type} 교재</span>
          {material.grade && <span>{material.grade}</span>}
        </div>
        <h1 className="text-2xl font-bold">{material.title || '제목 없음'}</h1>
        {material.subtitle && <p className="text-[14px] text-[#444] mt-1">{material.subtitle}</p>}
      </header>

      <div className="space-y-5">
        {material.blocks.length === 0 && <p className="text-[#999] text-sm">내용 블록이 없습니다.</p>}
        {material.blocks.map((b) => <BlockView key={b.id} block={b} showAnswers={showAnswers} />)}
      </div>
    </div>
  );
}

function BlockView({ block, showAnswers }: { block: MaterialBlock; showAnswers: boolean }) {
  const { kind, title, content, ko } = block;

  if (kind === 'heading') {
    return <h2 className="text-lg font-bold mt-2 pb-1 border-b border-[#ddd]">{content || title || ''}</h2>;
  }

  if (kind === 'text') {
    return (
      <section>
        {title && <h3 className="text-[15px] font-semibold mb-1">{title}</h3>}
        <p className="text-[14px] whitespace-pre-wrap">{content}</p>
      </section>
    );
  }

  if (kind === 'passage') {
    return (
      <section>
        {title && <h3 className="text-[15px] font-semibold mb-1">{title}</h3>}
        <p className="text-[14px] whitespace-pre-wrap leading-7">{content}</p>
        {ko && <p className="text-[13px] text-[#555] whitespace-pre-wrap mt-2 pt-2 border-t border-dashed border-[#ddd]">{ko}</p>}
      </section>
    );
  }

  if (kind === 'examples') {
    const rows = parseRows(content);
    return (
      <section>
        {title && <h3 className="text-[15px] font-semibold mb-1">{title}</h3>}
        <ol className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="text-[14px]">
              <span className="text-[#888] mr-1.5">{i + 1}.</span>{r.a}
              {r.b && <span className="text-[#666] ml-2">— {r.b}</span>}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (kind === 'vocab') {
    const rows = parseRows(content);
    return (
      <section>
        {title && <h3 className="text-[15px] font-semibold mb-1">{title}</h3>}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between gap-2 text-[14px] border-b border-dotted border-[#ddd] py-0.5">
              <span className="font-medium">{r.a}</span><span className="text-[#555]">{r.b}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (kind === 'problems') {
    const rows = parseRows(content);
    return (
      <section>
        {title && <h3 className="text-[15px] font-semibold mb-1">{title}</h3>}
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="text-[14px]">
              <span className="font-medium mr-1.5">{i + 1}.</span>{r.a}
              {showAnswers && r.b && <span className="ml-2 text-[#1565c0]">[정답: {r.b}]</span>}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return null;
}
