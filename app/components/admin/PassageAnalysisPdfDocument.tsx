'use client';

import { forwardRef } from 'react';
import type {
  GrammarPointEntry,
  GrammarTagStored,
  PassageStateStored,
  SvocSentenceData,
  SyntaxPhraseStored,
} from '@/lib/passage-analyzer-types';

// A4 가로 210mm, 좌우 마진 12mm → 본문 너비 186mm
const A4_W_MM = 210;
const PDF_MARGIN_MM = 12;
const CONTENT_W_MM = A4_W_MM - PDF_MARGIN_MM * 2;

// 큰 표 chunk size (시각적 fit 기준)
const SENTENCES_CHUNK = 12;
const TAGS_CHUNK = 11;
const POINTS_CHUNK = 6;
const VOCAB_CHUNK = 14;

const PALETTE = {
  primary: '#0f766e',
  primaryLight: '#ccfbf1',
  primarySoft: '#f0fdfa',
  rose: '#be123c',
  warn: '#b45309',
  ok: '#15803d',
  ink: '#0f172a',
  body: '#1f2937',
  muted: '#475569',
  faint: '#94a3b8',
  line: '#cbd5e1',
  thinLine: '#e2e8f0',
  zebra: '#f8fafc',
  headerBg: '#f1f5f9',
  white: '#ffffff',
} as const;

const FONT_STACK =
  '"Helvetica Neue", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Pretendard", sans-serif';

const MONO_STACK =
  '"JetBrains Mono", "Menlo", "Consolas", "Liberation Mono", monospace';

interface Props {
  state: PassageStateStored;
  passageMeta: {
    textbook?: string;
    chapter?: string;
    number?: string;
    source_key?: string;
  } | null;
  passageId?: string | null;
}

export const PassageAnalysisPdfDocument = forwardRef<HTMLDivElement, Props>(
  function PassageAnalysisPdfDocument({ state, passageMeta, passageId }, ref) {
    const today = new Date().toLocaleDateString('ko-KR');
    const titleParts = [passageMeta?.textbook, passageMeta?.chapter, passageMeta?.number].filter(
      (x) => x && String(x).trim()
    );
    const headerTitle =
      (passageMeta?.source_key && passageMeta.source_key.trim()) ||
      titleParts.join(' ').trim() ||
      '지문 분석';

    const sentences = state.sentences ?? [];
    const ko = state.koreanSentences ?? [];
    const comp = (state.analysisResults?.comprehensive ?? null) as Record<string, unknown> | null;
    const topic = state.topicHighlightedSentences ?? [];
    const essay = state.essayHighlightedSentences ?? [];
    const grammarWords = state.grammarSelectedWords ?? [];
    const contextWords = state.contextSelectedWords ?? [];
    const breaks = state.sentenceBreaks ?? {};
    const svoc = state.svocData ?? {};
    const phrases = state.syntaxPhrases ?? {};
    const tags = state.grammarTags ?? [];
    const points = state.grammarPointsBySentence ?? {};
    const vocab = state.vocabularyList ?? [];

    const compEntries = comp
      ? Object.entries(comp)
          .filter(([k, v]) => k !== 'error' && v != null && String(v).trim() !== '')
          .sort(([a], [b]) => comprehensiveOrder(a) - comprehensiveOrder(b))
      : [];

    // 다절 데이터(SvocSentenceData[]) 의 절별 row 평면화 — 같은 sentence 의 N개 절은 N개 row.
    // tuple: [sentenceIdx, clauseIdx, isFirstClauseOfSentence, clause]
    const sortedSvoc: Array<[number, number, boolean, SvocSentenceData]> = [];
    Object.entries(svoc)
      .map(([k, v]) => [Number(k), v] as [number, SvocSentenceData | SvocSentenceData[]])
      .filter(([k, v]) => Number.isFinite(k) && v != null)
      .sort((a, b) => a[0] - b[0])
      .forEach(([sentIdx, v]) => {
        const clauses = Array.isArray(v) ? v : [v];
        clauses.forEach((c, ci) => {
          if (!c) return;
          sortedSvoc.push([sentIdx, ci, ci === 0, c]);
        });
      });
    const sortedPhrases = Object.entries(phrases)
      .map(([k, v]) => [Number(k), v] as [number, SyntaxPhraseStored[]])
      .sort((a, b) => a[0] - b[0]);
    const sortedPoints = Object.entries(points)
      .map(([k, v]) => [Number(k), v] as [number, GrammarPointEntry[]])
      .sort((a, b) => a[0] - b[0]);

    // 점검 카운트
    const koOffsetMismatch = sentences.length !== ko.length;
    const koEmptyCount = ko.filter((s) => !s || !s.trim()).length;
    const compSlotCount = clamp(state.comprehensiveSlotCount, 5, 30);
    const breakSentenceCount = Object.entries(breaks).filter(
      ([, v]) => Array.isArray(v) && v.length > 0
    ).length;
    const svocSentenceCount = Object.keys(svoc).length;
    const phrasesSentenceCount = Object.keys(phrases).length;
    const pointsSentenceCount = Object.keys(points).length;

    const overview: OverviewRow[] = [
      {
        no: 1,
        label: '원문 · 해석',
        count: `EN ${sentences.length} · KO ${ko.length}`,
        status:
          sentences.length === 0
            ? { tone: 'warn', text: '비어 있음' }
            : koOffsetMismatch
              ? { tone: 'warn', text: '길이 불일치' }
              : koEmptyCount > 0
                ? { tone: 'warn', text: `KO 빈칸 ${koEmptyCount}` }
                : { tone: 'ok', text: 'OK' },
      },
      {
        no: 2,
        label: '종합분석 (comprehensive)',
        count: `${compEntries.length} / ${compSlotCount} 슬롯`,
        status:
          compEntries.length === 0
            ? { tone: 'warn', text: '비어 있음' }
            : compEntries.length < compSlotCount
              ? { tone: 'warn', text: '미완' }
              : { tone: 'ok', text: 'OK' },
      },
      {
        no: 3,
        label: '주제문장 (topicHighlighted)',
        count: `${topic.length}`,
        status:
          topic.length === 0 ? { tone: 'warn', text: '없음' } : { tone: 'ok', text: 'OK' },
      },
      {
        no: 4,
        label: '서술형 대비 (essayHighlighted)',
        count: `${essay.length}`,
        status:
          essay.length === 0 ? { tone: 'warn', text: '없음' } : { tone: 'ok', text: 'OK' },
      },
      {
        no: 5,
        label: '어법 (grammarSelectedWords)',
        count: `${grammarWords.length}`,
        status:
          grammarWords.length === 0 ? { tone: 'warn', text: '없음' } : { tone: 'ok', text: 'OK' },
      },
      {
        no: 6,
        label: '문맥 (contextSelectedWords)',
        count: `${contextWords.length}`,
        status:
          contextWords.length === 0 ? { tone: 'warn', text: '없음' } : { tone: 'ok', text: 'OK' },
      },
      {
        no: 7,
        label: '끊어읽기 (sentenceBreaks)',
        count: `${breakSentenceCount} / ${sentences.length} 문장`,
        status:
          breakSentenceCount === 0
            ? { tone: 'warn', text: '없음' }
            : breakSentenceCount < sentences.length
              ? { tone: 'warn', text: '부분' }
              : { tone: 'ok', text: 'OK' },
      },
      {
        no: 8,
        label: 'SVOC (svocData)',
        count: `${svocSentenceCount} / ${sentences.length} 문장`,
        status:
          svocSentenceCount === 0
            ? { tone: 'warn', text: '없음' }
            : svocSentenceCount < sentences.length
              ? { tone: 'warn', text: '부분' }
              : { tone: 'ok', text: 'OK' },
      },
      {
        no: 9,
        label: '구문 (syntaxPhrases)',
        count: `${phrasesSentenceCount} 문장 · ${countAllPhrases(phrases)} 구·절`,
        status:
          phrasesSentenceCount === 0
            ? { tone: 'warn', text: '없음' }
            : { tone: 'ok', text: 'OK' },
      },
      {
        no: 10,
        label: '문법태그 (grammarTags)',
        count: `${tags.length}`,
        status:
          tags.length === 0 ? { tone: 'warn', text: '없음' } : { tone: 'ok', text: 'OK' },
      },
      {
        no: 11,
        label: '문법 포인트 (grammarPointsBySentence)',
        count: `${pointsSentenceCount} 문장 · ${countAllPoints(points)} 카드`,
        status:
          pointsSentenceCount === 0
            ? { tone: 'warn', text: '없음' }
            : { tone: 'ok', text: 'OK' },
      },
      {
        no: 12,
        label: '단어장 (vocabularyList)',
        count: `${vocab.length}`,
        status:
          vocab.length === 0
            ? { tone: 'warn', text: '없음' }
            : vocab.length < 15
              ? { tone: 'warn', text: `권장 15+, 현재 ${vocab.length}` }
              : vocab.length > 30
                ? { tone: 'warn', text: `권장 ≤30, 현재 ${vocab.length}` }
                : { tone: 'ok', text: 'OK' },
      },
    ];

    const sentenceRows = sentences.map((en, i) => ({ i, en, ko: ko[i] ?? '' }));
    const sentenceChunks = chunkArray(sentenceRows, SENTENCES_CHUNK);
    const breakRows = sentences
      .map((en, i) => ({ i, en, b: breaks[i] }))
      .filter((r) => r.b && r.b.length > 0);
    const breakChunks = chunkArray(breakRows, SENTENCES_CHUNK);
    const svocChunks = chunkArray(sortedSvoc, SENTENCES_CHUNK);
    const tagsChunks = chunkArray(tags, TAGS_CHUNK);
    const pointsChunks = chunkArray(sortedPoints, POINTS_CHUNK);
    const vocabChunks = chunkArray(vocab, VOCAB_CHUNK);

    return (
      <div
        ref={ref}
        style={{
          width: `${CONTENT_W_MM}mm`,
          background: PALETTE.white,
          color: PALETTE.body,
          fontFamily: FONT_STACK,
          fontSize: '11px',
          lineHeight: 1.45,
          boxSizing: 'border-box',
        }}
      >
        {/* 표지 — 점검 메타 + 카운트 표 */}
        <div
          data-pdf-section="cover"
          style={{
            padding: '14px 16px',
            background: PALETTE.headerBg,
            border: `1px solid ${PALETTE.line}`,
            borderRadius: '6px',
            marginBottom: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '6px',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '9px',
                  color: PALETTE.muted,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                Passage Analysis · Review Sheet
              </div>
              <h1
                style={{
                  fontSize: '18px',
                  fontWeight: 800,
                  margin: '2px 0 0',
                  color: PALETTE.ink,
                  letterSpacing: '-0.01em',
                }}
              >
                지문 분석 데이터 점검
              </h1>
            </div>
            <div
              style={{
                fontSize: '10px',
                color: PALETTE.muted,
                textAlign: 'right',
                lineHeight: 1.6,
              }}
            >
              {today}
            </div>
          </div>

          <div
            style={{
              fontSize: '10px',
              color: PALETTE.body,
              lineHeight: 1.55,
              fontFamily: MONO_STACK,
              background: PALETTE.white,
              border: `1px solid ${PALETTE.thinLine}`,
              borderRadius: '4px',
              padding: '6px 8px',
              marginTop: '4px',
            }}
          >
            <div>source_key : {passageMeta?.source_key ?? '—'}</div>
            <div>textbook    : {passageMeta?.textbook ?? '—'}</div>
            <div>
              chapter / number : {passageMeta?.chapter ?? '—'} / {passageMeta?.number ?? '—'}
            </div>
            <div>passageId   : {passageId ?? '—'}</div>
          </div>

          <div style={{ marginTop: '10px' }}>
            <table style={tableStyle}>
              <colgroup>
                <col style={{ width: '6%' }} />
                <col style={{ width: '46%' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '18%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: PALETTE.zebra }}>
                  <th style={cellHead}>#</th>
                  <th style={cellHead}>분석 항목 (key)</th>
                  <th style={cellHead}>카운트</th>
                  <th style={cellHead}>상태</th>
                </tr>
              </thead>
              <tbody>
                {overview.map((row, i) => (
                  <tr key={row.no} style={i % 2 === 1 ? { background: PALETTE.zebra } : undefined}>
                    <td
                      style={{
                        ...cellBody,
                        textAlign: 'center',
                        color: PALETTE.muted,
                        fontWeight: 700,
                      }}
                    >
                      {row.no}
                    </td>
                    <td style={cellBody}>{row.label}</td>
                    <td style={{ ...cellBody, fontFamily: MONO_STACK, fontSize: '10px' }}>
                      {row.count}
                    </td>
                    <td style={cellBody}>
                      <StatusBadge tone={row.status.tone} text={row.status.text} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 1. 원문·해석 (with 단어/문자 카운트) */}
        {sentenceChunks.map((chunk, ci) => (
          <Section
            key={`p-${ci}`}
            sectionId={`p-${ci}`}
            no={ci === 0 ? 1 : null}
            title={ci === 0 ? '원문 · 해석' : '원문 · 해석 (계속)'}
            count={ci === 0 ? `${sentences.length} 문장` : undefined}
          >
            <table style={tableStyle}>
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '44%' }} />
                <col style={{ width: '44%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: PALETTE.headerBg }}>
                  <th style={cellHead}>#</th>
                  <th style={cellHead}>w · c</th>
                  <th style={cellHead}>English</th>
                  <th style={cellHead}>한국어</th>
                </tr>
              </thead>
              <tbody>
                {chunk.map((r, j) => {
                  const w = r.en ? r.en.split(/\s+/).filter(Boolean).length : 0;
                  const c = r.en ? r.en.length : 0;
                  return (
                    <tr key={r.i} style={j % 2 === 1 ? { background: PALETTE.zebra } : undefined}>
                      <td
                        style={{
                          ...cellBody,
                          textAlign: 'center',
                          color: PALETTE.muted,
                          fontWeight: 700,
                        }}
                      >
                        {r.i}
                      </td>
                      <td
                        style={{
                          ...cellBody,
                          fontFamily: MONO_STACK,
                          fontSize: '9px',
                          color: PALETTE.muted,
                          textAlign: 'center',
                        }}
                      >
                        {w}·{c}
                      </td>
                      <td style={cellBody}>{r.en}</td>
                      <td
                        style={{
                          ...cellBody,
                          color: r.ko ? PALETTE.muted : PALETTE.rose,
                        }}
                      >
                        {r.ko || '— (KO 비어있음)'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        ))}

        {/* 2. 종합분석 — 슬롯별 채움 여부 + raw 키 노출 */}
        <Section
          sectionId="comprehensive"
          no={2}
          title="종합분석"
          count={`${compEntries.length} / ${compSlotCount} 슬롯`}
        >
          {compEntries.length === 0 ? (
            <EmptyHint text="analysisResults.comprehensive 비어있음" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {compEntries.map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    background: PALETTE.primarySoft,
                    border: `1px solid ${PALETTE.primaryLight}`,
                    borderRadius: '4px',
                    padding: '6px 8px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '9px',
                      color: PALETTE.primary,
                      fontWeight: 700,
                      marginBottom: '2px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}
                  >
                    <span>{comprehensiveLabel(k)}</span>
                    <span style={{ fontFamily: MONO_STACK, color: PALETTE.muted, fontSize: '8.5px' }}>
                      key: {k}
                    </span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', color: PALETTE.body, fontSize: '10.5px' }}>
                    {String(v)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 3. 주제문장 */}
        <Section sectionId="topic" no={3} title="주제문장" count={`${topic.length}개`}>
          {topic.length === 0 ? (
            <EmptyHint text="topicHighlightedSentences = []" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {topic.map((idx) => (
                <div
                  key={idx}
                  style={{
                    borderLeft: `3px solid ${PALETTE.primary}`,
                    padding: '4px 8px',
                    background: PALETTE.primarySoft,
                    borderRadius: '0 4px 4px 0',
                  }}
                >
                  <div
                    style={{
                      fontSize: '9px',
                      color: PALETTE.muted,
                      fontWeight: 700,
                      fontFamily: MONO_STACK,
                      marginBottom: '2px',
                    }}
                  >
                    sentence[{idx}]
                  </div>
                  <div style={{ color: PALETTE.ink }}>{sentences[idx] ?? '—'}</div>
                  {ko[idx] ? (
                    <div style={{ color: PALETTE.muted, marginTop: '1px' }}>{ko[idx]}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 4. 서술형 대비 */}
        <Section sectionId="essay" no={4} title="서술형 대비 문장" count={`${essay.length}개`}>
          {essay.length === 0 ? (
            <EmptyHint text="essayHighlightedSentences = []" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {essay.map((idx) => (
                <div
                  key={idx}
                  style={{
                    borderLeft: `3px solid ${PALETTE.rose}`,
                    padding: '4px 8px',
                    background: '#fff1f2',
                    borderRadius: '0 4px 4px 0',
                  }}
                >
                  <div
                    style={{
                      fontSize: '9px',
                      color: PALETTE.muted,
                      fontWeight: 700,
                      fontFamily: MONO_STACK,
                      marginBottom: '2px',
                    }}
                  >
                    sentence[{idx}]
                  </div>
                  <div>{sentences[idx] ?? '—'}</div>
                  {ko[idx] ? (
                    <div style={{ color: PALETTE.muted, marginTop: '1px' }}>{ko[idx]}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 5. 어법 */}
        <Section
          sectionId="grammar-words"
          no={5}
          title="어법 선택 단어"
          count={`${grammarWords.length}개`}
        >
          {grammarWords.length === 0 ? (
            <EmptyHint text="grammarSelectedWords = []" />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {grammarWords.map((w, i) => (
                <span key={`${w}-${i}`} style={chipStyle('#fef3c7', '#92400e')}>
                  {w}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* 6. 문맥 */}
        <Section
          sectionId="context-words"
          no={6}
          title="문맥 선택 단어"
          count={`${contextWords.length}개`}
        >
          {contextWords.length === 0 ? (
            <EmptyHint text="contextSelectedWords = []" />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {contextWords.map((w, i) => (
                <span key={`${w}-${i}`} style={chipStyle('#dbeafe', '#1e40af')}>
                  {w}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* 7. 끊어읽기 — 슬래시 + word index raw */}
        {breakChunks.length > 0 ? (
          breakChunks.map((chunk, ci) => (
            <Section
              key={`br-${ci}`}
              sectionId={`br-${ci}`}
              no={ci === 0 ? 7 : null}
              title={ci === 0 ? '끊어읽기' : '끊어읽기 (계속)'}
              count={ci === 0 ? `${breakSentenceCount} / ${sentences.length} 문장` : undefined}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {chunk.map((r) => (
                  <div key={r.i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: '9px',
                        color: PALETTE.muted,
                        fontWeight: 700,
                        paddingTop: '2px',
                        minWidth: '20px',
                        fontFamily: MONO_STACK,
                      }}
                    >
                      [{r.i}]
                    </span>
                    <div style={{ flex: 1 }}>
                      <div>{renderBreaks(r.en, r.b ?? [])}</div>
                      <div
                        style={{
                          fontFamily: MONO_STACK,
                          fontSize: '9px',
                          color: PALETTE.muted,
                          marginTop: '1px',
                        }}
                      >
                        breaks: [{(r.b ?? []).join(', ')}]
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ))
        ) : (
          <Section sectionId="br-empty" no={7} title="끊어읽기" count="0 문장">
            <EmptyHint text="sentenceBreaks = {}" />
          </Section>
        )}

        {/* 8. SVOC — char offset 노출 */}
        {svocChunks.length > 0 ? (
          svocChunks.map((chunk, ci) => (
            <Section
              key={`svoc-${ci}`}
              sectionId={`svoc-${ci}`}
              no={ci === 0 ? 8 : null}
              title={ci === 0 ? 'SVOC 분석 (char offset)' : 'SVOC 분석 (계속)'}
              count={
                ci === 0 ? `${svocSentenceCount} / ${sentences.length} 문장` : undefined
              }
            >
              <table style={tableStyle}>
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '30%' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: PALETTE.headerBg }}>
                    <th style={cellHead}>#</th>
                    <th style={cellHead}>S</th>
                    <th style={cellHead}>V</th>
                    <th style={cellHead}>O / Oi / Od</th>
                    <th style={cellHead}>C / Cs / Co</th>
                  </tr>
                </thead>
                <tbody>
                  {chunk.map(([sentIdx, clauseIdx, isFirst, d], j) => (
                    <tr
                      key={`${sentIdx}-${clauseIdx}`}
                      style={j % 2 === 1 ? { background: PALETTE.zebra } : undefined}
                    >
                      <td
                        style={{
                          ...cellBody,
                          textAlign: 'center',
                          color: PALETTE.muted,
                          fontWeight: 700,
                        }}
                      >
                        {isFirst ? sentIdx : ''}
                        {!isFirst && (
                          <span style={{ fontSize: '8px', color: PALETTE.muted }}>
                            ↳절{clauseIdx + 1}
                          </span>
                        )}
                      </td>
                      <td style={cellBody}>
                        <SvocCell
                          text={d.subject}
                          start={d.subjectStart}
                          end={d.subjectEnd}
                          color="#fde68a"
                        />
                      </td>
                      <td style={cellBody}>
                        <SvocCell
                          text={d.verb}
                          start={d.verbStart}
                          end={d.verbEnd}
                          color="#bfdbfe"
                        />
                      </td>
                      <td style={cellBody}>
                        <SvocCell
                          text={d.object}
                          start={d.objectStart}
                          end={d.objectEnd}
                          color="#bbf7d0"
                          label="O"
                        />
                        <SvocCell
                          text={d.indirectObject}
                          start={d.indirectObjectStart}
                          end={d.indirectObjectEnd}
                          color="#bbf7d0"
                          label="Oi"
                        />
                        <SvocCell
                          text={d.directObject}
                          start={d.directObjectStart}
                          end={d.directObjectEnd}
                          color="#bbf7d0"
                          label="Od"
                        />
                      </td>
                      <td style={cellBody}>
                        <SvocCell
                          text={d.complement}
                          start={d.complementStart}
                          end={d.complementEnd}
                          color="#f5d0fe"
                          label="C"
                        />
                        <SvocCell
                          text={d.subjectComplement}
                          start={d.subjectComplementStart}
                          end={d.subjectComplementEnd}
                          color="#f5d0fe"
                          label="Cs"
                        />
                        <SvocCell
                          text={d.objectComplement}
                          start={d.objectComplementStart}
                          end={d.objectComplementEnd}
                          color="#f5d0fe"
                          label="Co"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))
        ) : (
          <Section sectionId="svoc-empty" no={8} title="SVOC 분석" count="0 문장">
            <EmptyHint text="svocData = {}" />
          </Section>
        )}

        {/* 9. 구문 — word index 범위 + color hex */}
        {sortedPhrases.length > 0 ? (
          sortedPhrases.map(([i, list], pi) => (
            <Section
              key={`ph-${i}`}
              sectionId={`ph-${i}`}
              no={pi === 0 ? 9 : null}
              title={pi === 0 ? '구문 분석 (word index)' : '구문 분석 (계속)'}
              subtitle={`sentence[${i}] · ${list.length}개`}
              count={pi === 0 ? `${phrasesSentenceCount} 문장` : undefined}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  paddingLeft: '4px',
                  borderLeft: `2px solid ${PALETTE.thinLine}`,
                }}
              >
                {list.map((p, j) => (
                  <div
                    key={j}
                    style={{
                      marginLeft: `${(p.depth ?? 0) * 12}px`,
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '6px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={chipStyle(p.color || '#e2e8f0', '#0f172a')}>{p.label}</span>
                    <span
                      style={{
                        fontFamily: MONO_STACK,
                        fontSize: '9px',
                        color: PALETTE.muted,
                      }}
                    >
                      w[{p.startIndex}–{p.endIndex}] · {p.type} · d{p.depth} ·{' '}
                      {p.color || '—'}
                    </span>
                    <span style={{ color: PALETTE.body }}>{p.text}</span>
                    {p.modifies ? (
                      <span style={{ color: PALETTE.muted, fontSize: '9.5px' }}>← {p.modifies}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </Section>
          ))
        ) : (
          <Section sectionId="ph-empty" no={9} title="구문 분석" count="0 문장">
            <EmptyHint text="syntaxPhrases = {}" />
          </Section>
        )}

        {/* 10. 문법태그 — word index 노출 */}
        {tagsChunks.length > 0 ? (
          tagsChunks.map((chunk, ci) => (
            <Section
              key={`tags-${ci}`}
              sectionId={`tags-${ci}`}
              no={ci === 0 ? 10 : null}
              title={ci === 0 ? '문법태그' : '문법태그 (계속)'}
              count={ci === 0 ? `${tags.length}개` : undefined}
            >
              <table style={tableStyle}>
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '34%' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: PALETTE.headerBg }}>
                    <th style={cellHead}>s#</th>
                    <th style={cellHead}>w[s–e]</th>
                    <th style={cellHead}>태그</th>
                    <th style={cellHead}>카테고리</th>
                    <th style={cellHead}>본문</th>
                    <th style={cellHead}>설명</th>
                  </tr>
                </thead>
                <tbody>
                  {chunk.map((t: GrammarTagStored, j) => (
                    <tr key={j} style={j % 2 === 1 ? { background: PALETTE.zebra } : undefined}>
                      <td
                        style={{
                          ...cellBody,
                          textAlign: 'center',
                          color: PALETTE.muted,
                          fontWeight: 700,
                        }}
                      >
                        {t.sentenceIndex ?? '?'}
                      </td>
                      <td
                        style={{
                          ...cellBody,
                          fontFamily: MONO_STACK,
                          fontSize: '9px',
                          textAlign: 'center',
                          color: PALETTE.muted,
                        }}
                      >
                        [{t.startWordIndex}–{t.endWordIndex}]
                      </td>
                      <td style={{ ...cellBody, fontWeight: 700, color: PALETTE.ink }}>
                        {t.tagName}
                      </td>
                      <td style={cellBody}>
                        {t.category ? (
                          <span style={chipStyle('#e0f2fe', '#075985')}>{t.category}</span>
                        ) : (
                          <span style={{ color: PALETTE.rose, fontSize: '9px' }}>—</span>
                        )}
                      </td>
                      <td style={cellBody}>{t.selectedText}</td>
                      <td style={{ ...cellBody, color: PALETTE.muted }}>
                        {t.explanation ?? (
                          <span style={{ color: PALETTE.rose, fontSize: '9px' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          ))
        ) : (
          <Section sectionId="tags-empty" no={10} title="문법태그" count="0개">
            <EmptyHint text="grammarTags = []" />
          </Section>
        )}

        {/* 11. 문법 포인트 */}
        {pointsChunks.length > 0 ? (
          pointsChunks.map((chunk, ci) => (
            <Section
              key={`pts-${ci}`}
              sectionId={`pts-${ci}`}
              no={ci === 0 ? 11 : null}
              title={ci === 0 ? '문법 포인트' : '문법 포인트 (계속)'}
              count={
                ci === 0
                  ? `${pointsSentenceCount} 문장 · ${countAllPoints(points)} 카드`
                  : undefined
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {chunk.map(([i, list]) => (
                  <div
                    key={i}
                    style={{
                      background: PALETTE.zebra,
                      padding: '6px 8px',
                      borderRadius: '4px',
                      border: `1px solid ${PALETTE.thinLine}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '9px',
                        color: PALETTE.muted,
                        fontWeight: 700,
                        marginBottom: '2px',
                        fontFamily: MONO_STACK,
                      }}
                    >
                      sentence[{i}] · {list.length}개
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '14px', listStyle: 'disc' }}>
                      {list.map((p, j) => (
                        <li key={j} style={{ marginBottom: '1px' }}>
                          <strong style={{ color: PALETTE.ink }}>{p.title}</strong>
                          <span style={{ color: PALETTE.body }}>: {p.content}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          ))
        ) : (
          <Section sectionId="pts-empty" no={11} title="문법 포인트" count="0 문장">
            <EmptyHint text="grammarPointsBySentence = {}" />
          </Section>
        )}

        {/* 12. 단어장 — positions 노출 */}
        {vocabChunks.length > 0 ? (
          vocabChunks.map((chunk, ci) => (
            <Section
              key={`vc-${ci}`}
              sectionId={`vc-${ci}`}
              no={ci === 0 ? 12 : null}
              title={ci === 0 ? '단어장' : '단어장 (계속)'}
              count={ci === 0 ? `${vocab.length}개` : undefined}
            >
              <table style={tableStyle}>
                <colgroup>
                  <col style={{ width: '4%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} />
                </colgroup>
                <thead>
                  <tr style={{ background: PALETTE.headerBg }}>
                    <th style={cellHead}>#</th>
                    <th style={cellHead}>단어</th>
                    <th style={cellHead}>품사</th>
                    <th style={cellHead}>CEFR</th>
                    <th style={cellHead}>position</th>
                    <th style={cellHead}>뜻</th>
                    <th style={cellHead}>유의어</th>
                    <th style={cellHead}>반의어</th>
                  </tr>
                </thead>
                <tbody>
                  {chunk.map((v, j) => {
                    const globalIdx = ci * VOCAB_CHUNK + j;
                    const positions = v.positions ?? [];
                    const posText = positions
                      .map((p) => `${p.sentence}:${p.position}`)
                      .join(', ');
                    return (
                      <tr
                        key={j}
                        style={j % 2 === 1 ? { background: PALETTE.zebra } : undefined}
                      >
                        <td
                          style={{
                            ...cellBody,
                            textAlign: 'center',
                            color: PALETTE.muted,
                            fontWeight: 700,
                          }}
                        >
                          {globalIdx + 1}
                        </td>
                        <td style={{ ...cellBody, fontWeight: 700, color: PALETTE.ink }}>
                          {v.word}
                        </td>
                        <td
                          style={{
                            ...cellBody,
                            textAlign: 'center',
                            color: PALETTE.muted,
                            fontSize: '9.5px',
                          }}
                        >
                          {v.partOfSpeech ?? (
                            <span style={{ color: PALETTE.rose }}>—</span>
                          )}
                        </td>
                        <td style={{ ...cellBody, textAlign: 'center' }}>
                          {v.cefr ? (
                            <span style={chipStyle(cefrBg(v.cefr), cefrFg(v.cefr))}>
                              {v.cefr}
                            </span>
                          ) : (
                            <span style={{ color: PALETTE.rose, fontSize: '9px' }}>—</span>
                          )}
                        </td>
                        <td
                          style={{
                            ...cellBody,
                            fontFamily: MONO_STACK,
                            fontSize: '9px',
                            color: positions.length === 0 ? PALETTE.rose : PALETTE.muted,
                          }}
                        >
                          {positions.length === 0 ? '—' : posText}
                        </td>
                        <td style={cellBody}>{v.meaning}</td>
                        <td style={{ ...cellBody, color: PALETTE.muted, fontSize: '9.5px' }}>
                          {v.synonym ?? ''}
                        </td>
                        <td style={{ ...cellBody, color: PALETTE.muted, fontSize: '9.5px' }}>
                          {v.antonym ?? ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Section>
          ))
        ) : (
          <Section sectionId="vc-empty" no={12} title="단어장" count="0개">
            <EmptyHint text="vocabularyList = []" />
          </Section>
        )}
      </div>
    );
  }
);

// ────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────

interface SectionProps {
  sectionId: string;
  no: number | null;
  title: string;
  subtitle?: string;
  count?: string;
  children: React.ReactNode;
}

function Section({ sectionId, no, title, subtitle, count, children }: SectionProps) {
  return (
    <div
      data-pdf-section={sectionId}
      style={{
        marginBottom: '10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '5px',
          paddingBottom: '3px',
          borderBottom: `1px solid ${PALETTE.thinLine}`,
        }}
      >
        {no != null ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '20px',
              height: '20px',
              padding: '0 5px',
              borderRadius: '4px',
              background: PALETTE.primary,
              color: PALETTE.white,
              fontSize: '10.5px',
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            {no}
          </span>
        ) : (
          <span
            style={{
              display: 'inline-block',
              width: '4px',
              height: '16px',
              borderRadius: '2px',
              background: PALETTE.primary,
              opacity: 0.4,
            }}
          />
        )}
        <h2
          style={{
            fontSize: '12.5px',
            fontWeight: 800,
            margin: 0,
            color: PALETTE.ink,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        {subtitle ? (
          <span style={{ fontSize: '10px', color: PALETTE.muted, fontWeight: 600 }}>
            · {subtitle}
          </span>
        ) : null}
        {count ? (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '9.5px',
              color: PALETTE.muted,
              fontWeight: 700,
              fontFamily: MONO_STACK,
              background: PALETTE.zebra,
              padding: '1px 6px',
              borderRadius: '3px',
              border: `1px solid ${PALETTE.thinLine}`,
            }}
          >
            {count}
          </span>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '6px 8px',
        background: '#fef2f2',
        border: `1px dashed #fca5a5`,
        borderRadius: '4px',
        color: PALETTE.rose,
        fontSize: '10px',
        fontFamily: MONO_STACK,
      }}
    >
      {text}
    </div>
  );
}

function SvocCell({
  text,
  start,
  end,
  color,
  label,
}: {
  text?: string | null;
  start?: number | null;
  end?: number | null;
  color: string;
  label?: string;
}) {
  if (text == null || text === '') return null;
  const range =
    start != null && end != null && start >= 0 && end >= 0 ? `[${start}–${end}]` : '[?]';
  return (
    <div style={{ marginBottom: '1px' }}>
      {label ? (
        <span
          style={{
            fontFamily: MONO_STACK,
            fontSize: '8.5px',
            color: PALETTE.muted,
            marginRight: '3px',
            fontWeight: 700,
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        style={{
          background: color,
          padding: '0 4px',
          borderRadius: '3px',
          color: '#0f172a',
        }}
      >
        {text}
      </span>
      <span
        style={{
          fontFamily: MONO_STACK,
          fontSize: '8.5px',
          color: PALETTE.muted,
          marginLeft: '4px',
        }}
      >
        {range}
      </span>
    </div>
  );
}

type StatusTone = 'ok' | 'warn';

function StatusBadge({ tone, text }: { tone: StatusTone; text: string }) {
  const colors =
    tone === 'ok'
      ? { bg: '#dcfce7', fg: PALETTE.ok }
      : { bg: '#fef3c7', fg: PALETTE.warn };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: '10px',
        background: colors.bg,
        color: colors.fg,
        fontSize: '9px',
        fontWeight: 800,
        letterSpacing: '0.02em',
      }}
    >
      {text}
    </span>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  border: `1px solid ${PALETTE.line}`,
  borderRadius: '4px',
  overflow: 'hidden',
};

const cellHead: React.CSSProperties = {
  borderBottom: `2px solid ${PALETTE.line}`,
  borderRight: `1px solid ${PALETTE.thinLine}`,
  padding: '4px 6px',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: '9.5px',
  color: PALETTE.ink,
};

const cellBody: React.CSSProperties = {
  borderRight: `1px solid ${PALETTE.thinLine}`,
  borderBottom: `1px solid ${PALETTE.thinLine}`,
  padding: '4px 6px',
  fontSize: '10.5px',
  verticalAlign: 'top',
  wordBreak: 'break-word',
};

function chipStyle(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '1px 7px',
    borderRadius: '10px',
    background: bg,
    color,
    fontSize: '9.5px',
    fontWeight: 700,
    lineHeight: 1.5,
  };
}

function renderBreaks(en: string, breaks: number[]): React.ReactNode {
  const words = en.split(/\s+/);
  const set = new Set(breaks);
  return (
    <span style={{ wordBreak: 'break-word' }}>
      {words.map((w, i) => (
        <span key={i}>
          {w}
          {set.has(i) ? (
            <span style={{ color: PALETTE.rose, fontWeight: 800, padding: '0 3px' }}>/</span>
          ) : null}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

function chunkArray<T>(arr: T[], n: number): T[][] {
  if (!arr || arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function clamp(n: number | undefined, min: number, max: number): number {
  const v = Number(n ?? min);
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function countAllPhrases(p: Record<number, SyntaxPhraseStored[]>): number {
  return Object.values(p).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
}

function countAllPoints(p: Record<number, GrammarPointEntry[]>): number {
  return Object.values(p).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
}

interface OverviewRow {
  no: number;
  label: string;
  count: string;
  status: { tone: StatusTone; text: string };
}

const COMP_ORDER_MAP: Record<string, number> = {
  '1': 11,
  '2': 12,
  '3': 13,
  '4': 14,
  '5': 15,
  koreanTopic: 21,
  originalSentence: 22,
  englishSummary: 23,
  koreanTranslation: 24,
  implicitMeaning: 25,
};

function comprehensiveOrder(key: string): number {
  if (COMP_ORDER_MAP[key] != null) return COMP_ORDER_MAP[key];
  const m1 = key.match(/^(\d+)$/);
  if (m1) return 10 + Number(m1[1]);
  const m2 = key.match(/^item_(\d+)$/);
  if (m2) return 30 + Number(m2[1]);
  return 100;
}

function comprehensiveLabel(key: string): string {
  const labels: Record<string, string> = {
    koreanTopic: '한글 주제',
    originalSentence: '원문 주제문장',
    englishSummary: '영문 요약',
    koreanTranslation: '한글 번역',
    implicitMeaning: '함축적 표현',
    '1': '주제',
    '2': '요지',
    '3': '요약',
    '4': '해석',
    '5': '함의',
  };
  if (labels[key]) return labels[key];
  const m = key.match(/^item_(\d+)$/);
  if (m) return `추가 항목 ${m[1]}`;
  return key;
}

function cefrBg(level: string): string {
  switch (level.toUpperCase()) {
    case 'A1':
      return '#dcfce7';
    case 'A2':
      return '#bbf7d0';
    case 'B1':
      return '#fef9c3';
    case 'B2':
      return '#fed7aa';
    case 'C1':
      return '#fecdd3';
    case 'C2':
      return '#fbcfe8';
    default:
      return '#e2e8f0';
  }
}

function cefrFg(level: string): string {
  switch (level.toUpperCase()) {
    case 'A1':
    case 'A2':
      return '#166534';
    case 'B1':
      return '#854d0e';
    case 'B2':
      return '#9a3412';
    case 'C1':
      return '#9f1239';
    case 'C2':
      return '#9d174d';
    default:
      return '#1e293b';
  }
}
