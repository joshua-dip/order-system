'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppBar from '../../components/AppBar';
import OrderDisplay from '../../components/OrderDisplay';

const STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

function OrderDoneContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const [order, setOrder] = useState<{ orderText: string; status: string; orderNumber: string | null; fileUrl: string | null } | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState('');
  const [user, setUser] = useState<{ loginId: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('주문 정보가 없습니다.');
      setLoading(false);
      return;
    }
    Promise.all([
      fetch('/api/orders/' + id).then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
    ]).then(([orderData, authData]) => {
      setLoading(false);
      if (orderData.error) {
        setError(orderData.error);
        return;
      }
      setOrder({
        orderText: orderData.orderText,
        status: orderData.status || 'pending',
        orderNumber: orderData.orderNumber ?? null,
        fileUrl: orderData.fileUrl ?? null,
      });
      if (authData.user) setUser(authData.user);
    });
  }, [id]);

  const handleCancelOrder = async () => {
    if (!id || order?.status !== 'pending') return;
    if (!confirm('이 주문을 취소하시겠습니까?')) return;
    setCancelling(true);
    try {
      const res = await fetch('/api/orders/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setOrder((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
      } else {
        alert(data.error || '취소에 실패했습니다.');
      }
    } catch {
      alert('취소 요청 중 오류가 발생했습니다.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <>
        <AppBar title="커스터마이징 서비스" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (error || !order) {
    return (
      <>
        <AppBar title="커스터마이징 서비스" />
        <div className="min-h-screen py-8 px-4 bg-gray-50">
          <div className="max-w-lg mx-auto text-center">
            <p className="text-gray-600 mb-4">{error || '주문을 불러올 수 없습니다.'}</p>
            <Link href="/" className="text-blue-600 hover:underline">
              메인으로
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="커스터마이징 서비스" />
      <div className="min-h-screen py-8 px-4" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="max-w-2xl mx-auto">
          <p className="text-center mb-4">
            <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
              ← 메인 화면으로
            </Link>
          </p>

          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">주문서가 접수되었습니다</h1>
            <p className="text-gray-600">아래 내용을 확인하시고 문의 시 참고해 주세요.</p>
            {order.orderNumber && (
              <p className="mt-2 text-sm text-gray-500">
                주문번호: <span className="font-mono font-semibold text-gray-700">{order.orderNumber}</span>
              </p>
            )}
            <div
              className={`inline-block mt-3 px-4 py-2 rounded-lg text-sm font-medium ${
                order.status === 'cancelled'
                  ? 'bg-gray-200 text-gray-600'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {STATUS_LABELS[order.status] || order.status}
            </div>
          </div>

          {user && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
              <strong>회원 로그인 상태입니다.</strong> 내정보에서 이 주문서를 다시 확인하고, 제작 수락·입금 확인·제작 진행 상황을 볼 수 있습니다.
            </div>
          )}

          <p className="mb-6 text-center text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl py-3 px-4">
            주문한 이력을 카톡 또는 문자로 꼭 알려주세요.
          </p>

          <OrderDisplay
            orderText={order.orderText}
            onClear={() => router.push('/')}
          />

          {order.fileUrl && (
            <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-indigo-800">자료가 준비되었습니다</p>
                <p className="text-xs text-indigo-600 mt-0.5">아래 버튼을 눌러 드롭박스에서 다운로드하세요.</p>
              </div>
              <a
                href={order.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                자료 다운로드
              </a>
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {order.status === 'pending' && (
              <button
                type="button"
                onClick={handleCancelOrder}
                disabled={cancelling}
                className="px-6 py-3 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium disabled:opacity-50"
              >
                {cancelling ? '취소 중…' : '주문 취소'}
              </button>
            )}
            <Link
              href="/"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              메인으로
            </Link>
            {user && (
              <Link
                href="/my"
                className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
              >
                내정보에서 보기
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function OrderDonePage() {
  return (
    <Suspense fallback={
      <>
        <AppBar title="커스터마이징 서비스" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </>
    }>
      <OrderDoneContent />
    </Suspense>
  );
}
