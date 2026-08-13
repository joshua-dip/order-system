'use client';

import { NON_FICTION_GENRES, LITERATURE_GENRES } from '@/lib/korean-explainer/types';

export interface MetaState {
  textbook: string;
  sourceKey: string;
  setRange: string;
  genre: string;
  workTitle: string;
  examTitle: string;
  showSubtitle: boolean;
  folder: string;
  passageId: string;
}

interface MetaEditorProps {
  meta: MetaState;
  onChange: (next: MetaState) => void;
}

export default function MetaEditor({ meta, onChange }: MetaEditorProps) {
  function update<K extends keyof MetaState>(key: K, value: MetaState[K]) {
    onChange({ ...meta, [key]: value });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 bg-white rounded-lg border border-gray-200">
      <Field label="시험 제목 (examTitle)">
        <input
          className="input"
          placeholder="예: 2025학년도 3월 고1 국어 모의고사 해설"
          value={meta.examTitle}
          onChange={e => update('examTitle', e.target.value)}
        />
      </Field>

      <Field label="문항 범위 (setRange)">
        <input
          className="input"
          placeholder="예: 22-25"
          value={meta.setRange}
          onChange={e => update('setRange', e.target.value)}
        />
      </Field>

      <Field label="교재 (textbook)">
        <input
          className="input"
          placeholder="예: 2025학년도 3월 고1 국어 모의고사"
          value={meta.textbook}
          onChange={e => update('textbook', e.target.value)}
        />
      </Field>

      <Field label="원문 키 (sourceKey)">
        <input
          className="input"
          placeholder="예: 25-03-go1-22-25"
          value={meta.sourceKey}
          onChange={e => update('sourceKey', e.target.value)}
        />
      </Field>

      <Field label="갈래 (genre)">
        <select
          className="input"
          value={meta.genre}
          onChange={e => update('genre', e.target.value)}
        >
          <option value="">— 선택 —</option>
          <optgroup label="비문학 (편집기 우선 지원)">
            {NON_FICTION_GENRES.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </optgroup>
          <optgroup label="문학 (JSON 직편집)">
            {LITERATURE_GENRES.map(g => (
              <option key={g} value={g}>{g} ⚠ import 대기</option>
            ))}
          </optgroup>
        </select>
      </Field>

      <Field label="작품/지문 제목 (workTitle)">
        <input
          className="input"
          placeholder="예: 이문구 「암소」"
          value={meta.workTitle}
          onChange={e => update('workTitle', e.target.value)}
        />
      </Field>

      <Field label="폴더 (folder)">
        <input
          className="input"
          placeholder="기본"
          value={meta.folder}
          onChange={e => update('folder', e.target.value)}
        />
      </Field>

      <Field label="원문 ObjectId (passageId, 선택)">
        <input
          className="input"
          placeholder="향후 korean_passages 도입 시"
          value={meta.passageId}
          onChange={e => update('passageId', e.target.value)}
        />
      </Field>

      <Field label="옵션">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={meta.showSubtitle}
            onChange={e => update('showSubtitle', e.target.checked)}
          />
          표지 부제 (LYCEUM ... · 학력평가 해설) 표시
        </label>
      </Field>

      <style jsx>{`
        .input {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 13px;
          color: #111827;
          background: white;
        }
        .input:focus {
          outline: 2px solid rgb(225 29 72 / 0.4);
          outline-offset: -1px;
          border-color: rgb(225 29 72);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
