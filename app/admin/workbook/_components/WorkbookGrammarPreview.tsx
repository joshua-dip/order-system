'use client';

export function WorkbookGrammarPreview({ data }: { data: Record<string, unknown> }) {
  const paragraph = typeof data.Paragraph === 'string' ? data.Paragraph
    : typeof data.paragraph === 'string' ? data.paragraph : '';
  const answerText = typeof data.AnswerText === 'string' ? data.AnswerText
    : typeof data.answer_text === 'string' ? data.answer_text : '';
  const explanation = typeof data.Explanation === 'string' ? data.Explanation
    : typeof data.explanation === 'string' ? data.explanation : '';

  const renderParagraph = (text: string) => {
    const parts = text.split(/(\[[^\]]+\/[^\]]+\])/g);
    return parts.map((part, i) => {
      if (/^\[.+\/.+\]$/.test(part)) {
        return (
          <span key={i} className="inline-block bg-amber-100 text-amber-900 font-bold rounded px-1 mx-0.5">
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">지문 (양자택일)</p>
        <p className="text-sm leading-relaxed text-slate-800">{renderParagraph(paragraph)}</p>
      </div>
      {answerText && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
          <p className="text-xs font-bold text-amber-700 mb-2">정답</p>
          <pre className="text-sm text-amber-900 whitespace-pre-wrap font-sans">{answerText}</pre>
        </div>
      )}
      {explanation && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-500 mb-2">해설</p>
          <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans">{explanation}</pre>
        </div>
      )}
    </div>
  );
}
