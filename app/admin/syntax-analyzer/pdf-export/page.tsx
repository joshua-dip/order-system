'use client';

import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export default function PdfExportPage() {
  const ref = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState('지문');
  const [body, setBody] = useState('');

  async function exportPdf() {
    if (!ref.current) return;
    try {
      const canvas = await html2canvas(ref.current, { scale: 2, useCORS: true });
      const img = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const margin = 10;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height * imgW) / canvas.width;
      pdf.addImage(img, 'PNG', margin, margin, imgW, imgH);
      pdf.save(`${title.replace(/\s+/g, '_') || 'passage'}.pdf`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'PDF 생성 실패');
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-xl font-bold">PDF보내기</h1>
      <p className="text-slate-400 text-sm">
        미리보기 영역을 캡처해 A4 PDF로 저장합니다. (한글 폰트는 브라우저 기본 스타일에 따릅니다.)
      </p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
        placeholder="제목"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
        placeholder="원문·해석 등 붙여넣기"
      />
      <button
        type="button"
        onClick={exportPdf}
        className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-sm font-bold"
      >
        PDF 저장
      </button>

      <div
        ref={ref}
        className="bg-white text-black p-6 rounded-lg max-w-[210mm] mx-auto text-[13px] leading-relaxed"
        style={{ fontFamily: 'system-ui, sans-serif' }}
      >
        <h2 className="text-lg font-bold mb-3">{title || '제목'}</h2>
        <div className="whitespace-pre-wrap">{body}</div>
      </div>
    </div>
  );
}
