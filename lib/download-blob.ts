/**
 * Blob 을 파일로 안전하게 다운로드.
 * - 앵커를 DOM 에 부착 (Firefox 등은 detached 앵커 click 무시)
 * - revoke 를 지연 (즉시 revoke 하면 큰 파일에서 다운로드가 시작 전 취소됨)
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 3000);
}
