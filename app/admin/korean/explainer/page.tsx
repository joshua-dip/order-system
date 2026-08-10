'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminSidebar from '../../_components/AdminSidebar';
import MetaEditor, { type MetaState } from './_components/MetaEditor';
import BlocksEditor from './_components/BlocksEditor';
import PreviewPane from './_components/PreviewPane';
import ActionBar from './_components/ActionBar';
import type { Block, KoreanExplanation } from '@/lib/korean-explainer/types';

const EMPTY_META: MetaState = {
  textbook: '',
  sourceKey: '',
  setRange: '',
  genre: '',
  workTitle: '',
  examTitle: '',
  showSubtitle: false,
  folder: '기본',
  passageId: '',
};

function autoCover(meta: MetaState): Block[] {
  if (!meta.examTitle || !meta.setRange || !meta.genre || !meta.workTitle) return [];
  return [
    {
      type: 'cover',
      data: {
        exam_title: meta.examTitle,
        set_range: meta.setRange,
        genre: meta.genre,
        work_title: meta.workTitle,
        show_subtitle: meta.showSubtitle,
      },
    },
  ];
}

export default function KoreanExplainerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const loadId = searchParams.get('id');

  const [loginId, setLoginId] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  const [meta, setMeta] = useState<MetaState>(EMPTY_META);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [docId, setDocId] = useState<string | null>(null);

  const [cssBundle, setCssBundle] = useState<{ stylesCss: string; printFixCss: string } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setLoginId(d.user.loginId ?? '');
        setAuthChecked(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  useEffect(() => {
    if (!authChecked) return;
    fetch('/api/admin/korean-explainer/css', { credentials: 'include' })
      .then(r => r.text())
      .then(combined => {
        setCssBundle({ stylesCss: combined, printFixCss: '' });
      })
      .catch(e => setLoadErr(`CSS 로드 실패: ${e}`));
  }, [authChecked]);

  useEffect(() => {
    if (!authChecked || !loadId) return;
    fetch(`/api/admin/korean-explainer/${loadId}`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `${r.status}`);
        }
        return r.json();
      })
      .then((data: { doc: { _id: string; textbook?: string; sourceKey?: string; setRange?: string; genre?: string; workTitle?: string; examTitle?: string; showSubtitle?: boolean; folder?: string; passageId?: string; blocks?: Block[] } }) => {
        const d = data.doc;
        setDocId(d._id);
        setMeta({
          textbook: d.textbook ?? '',
          sourceKey: d.sourceKey ?? '',
          setRange: d.setRange ?? '',
          genre: d.genre ?? '',
          workTitle: d.workTitle ?? '',
          examTitle: d.examTitle ?? '',
          showSubtitle: !!d.showSubtitle,
          folder: d.folder ?? '기본',
          passageId: d.passageId ?? '',
        });
        setBlocks(Array.isArray(d.blocks) ? d.blocks : []);
      })
      .catch(e => setLoadErr(`해설지 로드 실패: ${e instanceof Error ? e.message : String(e)}`));
  }, [authChecked, loadId]);

  const previewDoc: KoreanExplanation = useMemo(() => ({
    exam_title: meta.examTitle || '(시험 제목)',
    set_range: meta.setRange || '(범위)',
    genre: meta.genre || '(갈래)',
    work_title: meta.workTitle || '(작품)',
    show_subtitle: meta.showSubtitle,
    blocks: blocks.length > 0 ? blocks : autoCover(meta),
  }), [meta, blocks]);

  const onSaved = useCallback((id: string) => {
    setDocId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    window.history.replaceState({}, '', url.toString());
  }, []);

  if (!authChecked) {
    return <div className="min-h-svh flex items-center justify-center text-gray-500">인증 확인 중…</div>;
  }

  return (
    <div className="flex min-h-svh bg-gray-100">
      <AdminSidebar loginId={loginId} />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300">
              KOREAN · 국어
            </span>
            <h1 className="text-lg font-bold text-gray-900">국어 해설지 생성기</h1>
            {docId && (
              <span className="text-xs text-gray-500">
                · ID: <code className="bg-gray-100 px-1 py-0.5 rounded">{docId}</code>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/korean/explainer/list"
              className="text-xs text-rose-700 hover:underline"
            >
              📂 목록
            </Link>
            <button
              type="button"
              onClick={() => {
                setDocId(null);
                setMeta(EMPTY_META);
                setBlocks([]);
                const url = new URL(window.location.href);
                url.searchParams.delete('id');
                window.history.replaceState({}, '', url.toString());
              }}
              className="text-xs text-gray-600 hover:underline"
            >
              + 새로 만들기
            </button>
          </div>
        </header>

        {loadErr && (
          <div className="bg-red-50 text-red-800 px-4 py-2 text-sm border-b border-red-200">{loadErr}</div>
        )}

        <div className="flex-1 flex min-h-0">
          <div className="w-[55%] flex flex-col min-w-0 border-r border-gray-200 overflow-y-auto p-4 gap-3">
            <MetaEditor meta={meta} onChange={setMeta} />
            <BlocksEditor
              blocks={blocks}
              onChange={setBlocks}
              coverPrefill={{
                exam_title: meta.examTitle,
                set_range: meta.setRange,
                genre: meta.genre,
                work_title: meta.workTitle,
                show_subtitle: meta.showSubtitle,
              }}
            />
          </div>

          <div className="w-[45%] flex flex-col min-w-0 bg-gray-200 p-3 overflow-y-auto">
            <div className="text-xs font-bold text-gray-700 mb-2 flex items-center justify-between">
              <span>👁 미리보기 (iframe srcDoc)</span>
              <span className="text-[10px] text-gray-500 font-normal">블록 {blocks.length}개</span>
            </div>
            <div className="flex-1 min-h-[500px]">
              {cssBundle ? (
                <PreviewPane doc={previewDoc} stylesCss={cssBundle.stylesCss} printFixCss={cssBundle.printFixCss} />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">CSS 로드 중…</div>
              )}
            </div>
          </div>
        </div>

        {cssBundle && (
          <ActionBar
            doc={previewDoc}
            stylesCss={cssBundle.stylesCss}
            printFixCss={cssBundle.printFixCss}
            docId={docId}
            saveMeta={meta}
            onSaved={onSaved}
            disabled={!meta.examTitle || !meta.setRange || !meta.textbook || !meta.sourceKey || !meta.genre || !meta.workTitle || blocks.length === 0}
          />
        )}
      </main>
    </div>
  );
}
