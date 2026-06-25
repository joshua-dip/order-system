'use client';

/**
 * 글로벌 에러 바운더리 — 루트 레이아웃 자체에서 예외가 났을 때만 동작.
 * 이 파일이 있어야 Next 기본 "Application error: a client-side exception has occurred"
 * 흰 화면 대신 아래 친절한 화면이 뜬다. (자체 <html><body> 를 렌더해야 함)
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global error]', error, error?.digest ? `digest=${error.digest}` : '');
  }, [error]);

  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
            background: 'linear-gradient(to bottom, #f8fafc, #ffffff)',
            color: '#0f172a',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>일시적인 오류가 발생했어요</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: '#475569', maxWidth: 360 }}>
            잠시 후 다시 시도해 주세요. 문제가 계속되면 새로고침하거나 학원으로 문의해 주세요.
          </p>
          <div style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '8px 16px', borderRadius: 12, border: 'none',
                background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px', borderRadius: 12, border: '1px solid #e2e8f0',
                background: '#fff', color: '#334155', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              새로고침
            </button>
          </div>
          {error?.digest && (
            <p style={{ marginTop: 16, fontSize: 11, color: '#94a3b8' }}>오류 코드: {error.digest}</p>
          )}
        </div>
      </body>
    </html>
  );
}
