'use client';

import { useState } from 'react';
import { renderStandaloneDocument } from '@/lib/korean-explainer/render';
import type { KoreanExplanation } from '@/lib/korean-explainer/types';

interface ActionBarProps {
  doc: KoreanExplanation;
  stylesCss: string;
  printFixCss: string;
  /** 현재 편집 중 문서의 _id (있으면 update). */
  docId: string | null;
  saveMeta: {
    textbook: string;
    sourceKey: string;
    setRange: string;
    genre: string;
    workTitle: string;
    examTitle: string;
    showSubtitle?: boolean;
    folder: string;
    passageId?: string;
  };
  onSaved: (id: string) => void;
  disabled?: boolean;
}

export default function ActionBar({ doc, stylesCss, printFixCss, docId, saveMeta, onSaved, disabled }: ActionBarProps) {
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string>('');

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const body = {
        id: docId ?? undefined,
        passageId: saveMeta.passageId || undefined,
        textbook: saveMeta.textbook,
        sourceKey: saveMeta.sourceKey,
        setRange: saveMeta.setRange,
        genre: saveMeta.genre,
        workTitle: saveMeta.workTitle,
        examTitle: saveMeta.examTitle,
        showSubtitle: saveMeta.showSubtitle ?? false,
        folder: saveMeta.folder,
        blocks: doc.blocks,
      };
      const res = await fetch('/api/admin/korean-explainer/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(data.details) ? `\n· ${data.details.join('\n· ')}` : '';
        setSaveMsg(`❌ ${data.error ?? '저장 실패'}${detail}`);
        return;
      }
      onSaved(data.id);
      setSaveMsg(`✓ 저장 완료 — ${data.id}`);
    } catch (e) {
      setSaveMsg(`❌ ${e instanceof Error ? e.message : '저장 실패'}`);
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    const html = renderStandaloneDocument(doc, { stylesCss, printFixCss });
    const w = window.open('', '_blank');
    if (!w) {
      alert('팝업 차단을 해제해 주세요.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // 폰트 로드 등 안정성 확보 후 인쇄 다이얼로그
    w.addEventListener('load', () => {
      setTimeout(() => w.print(), 200);
    });
  }

  async function handlePdf() {
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      // 미리보기와 동일한 결과물을 보장하기 위해 hidden iframe 에 동일 srcDoc 을 렌더하고 캡처
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-99999px';
      iframe.style.top = '0';
      iframe.style.width = '210mm';
      iframe.style.height = '297mm';
      iframe.style.border = '0';
      iframe.srcdoc = renderStandaloneDocument(doc, { stylesCss, printFixCss });
      document.body.appendChild(iframe);

      await new Promise<void>((resolve) => {
        iframe.addEventListener('load', () => resolve(), { once: true });
      });

      // 폰트 로드 대기
      await new Promise(r => setTimeout(r, 300));

      const idoc = iframe.contentDocument!;
      const body = idoc.body;
      const canvas = await html2canvas(body, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: body.scrollWidth,
        windowHeight: body.scrollHeight,
      });
      document.body.removeChild(iframe);

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'p' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgRatio = canvas.height / canvas.width;
      const imgW = pageW;
      const imgH = pageW * imgRatio;
      const imgData = canvas.toDataURL('image/jpeg', 0.92);

      // 여러 페이지에 걸쳐 분할
      let positionY = 0;
      while (positionY < imgH) {
        pdf.addImage(imgData, 'JPEG', 0, -positionY, imgW, imgH);
        positionY += pageH;
        if (positionY < imgH) pdf.addPage();
      }
      const fname = `[${saveMeta.setRange || 'set'}] ${saveMeta.examTitle || '국어해설'}.pdf`.replace(/[/\\:*?"<>|]/g, ' ');
      pdf.save(fname);
    } catch (e) {
      alert(`PDF 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3 flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={handleSave}
        disabled={disabled || saving}
        className="px-4 py-2 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? '저장 중…' : docId ? '💾 덮어쓰기' : '💾 저장'}
      </button>
      <button
        type="button"
        onClick={handlePrint}
        disabled={disabled}
        className="px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-800 font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        🖨 새 창 인쇄
      </button>
      <button
        type="button"
        onClick={handlePdf}
        disabled={disabled}
        className="px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-800 font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        📄 PDF 저장
      </button>
      {saveMsg && (
        <span className={`ml-3 text-sm ${saveMsg.startsWith('✓') ? 'text-green-700' : 'text-red-700'} whitespace-pre-line`}>
          {saveMsg}
        </span>
      )}
    </div>
  );
}
