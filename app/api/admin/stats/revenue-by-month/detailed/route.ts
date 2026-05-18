import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { effectiveOrderRevenueWon } from '@/lib/order-revenue';
import { revenueMonthKeyForOrder } from '@/lib/order-number';
import {
  parseMockExamSelections,
  mockExamNumberIdToLabel,
} from '@/lib/mock-variant-order';

/**
 * 월별 상세 매출 — XLSX 다운로드.
 *
 * 시트 3개:
 *   1) 월별 요약 — 월/건수/매출
 *   2) 주문 — 한 주문 한 행 (주문번호·완료일시·회원·유형·교재·항목수·매출·메모)
 *   3) 항목 — 주문의 BV lesson / MV exam·번호 단위로 행 전개 (어떤 자료가 팔렸는지 분석용)
 *
 * 매출 계산은 /api/admin/stats/revenue-by-month 와 동일하게 effectiveOrderRevenueWon 사용 —
 * 쏠북 연계 BV는 chargedExtraFeeWon, 그 외는 저장된 revenueWon 또는 orderText 파싱.
 */

const FLOW_LABEL: Record<string, string> = {
  bookVariant: '부교재 변형 (BV)',
  mockVariant: '모의고사 변형 (MV)',
  unifiedVariant: '통합 변형',
  workbook: '워크북 (W)',
  vocabulary: '단어장 (BL)',
  essay: '서술형',
};

function flowLabel(flow: string): string {
  if (!flow) return '미지정';
  return FLOW_LABEL[flow] ?? flow;
}

function s(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  try { return JSON.stringify(v); } catch { return ''; }
}

function dateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && '$date' in (v as Record<string, unknown>)) {
    const d = (v as Record<string, unknown>).$date;
    if (typeof d === 'string') return d;
    if (d instanceof Date) return d.toISOString();
  }
  return '';
}

interface ExpandedItem {
  /** 항목 라벨 — 분석용 핵심 (예: "01강 02번", "26년 3월 고1 영어모의고사 18번", "단어장(3지문)") */
  label: string;
  /** 교재명 (BV: selectedTextbook / MV: examSelections.exam / 그 외: 빈 문자열) */
  textbook: string;
  /** 변형 유형 메모 (selectedTypes 콤마 결합 등) */
  variantTypes: string;
}

function extractItems(meta: Record<string, unknown>, flow: string): ExpandedItem[] {
  const variantTypes = Array.isArray(meta.selectedTypes)
    ? (meta.selectedTypes as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map(s => s.trim())
        .filter(Boolean)
        .join(', ')
    : '';

  if (flow === 'bookVariant') {
    const textbook = typeof meta.selectedTextbook === 'string' ? meta.selectedTextbook : '';
    const lessons = Array.isArray(meta.selectedLessons)
      ? (meta.selectedLessons as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (lessons.length === 0) {
      return [{ label: '(지문 없음)', textbook, variantTypes }];
    }
    return lessons.map(label => ({ label, textbook, variantTypes }));
  }

  if (flow === 'mockVariant') {
    const sels = parseMockExamSelections(meta.examSelections);
    if (sels.length === 0) return [{ label: '(시험 없음)', textbook: '', variantTypes }];
    const out: ExpandedItem[] = [];
    for (const sel of sels) {
      for (const num of sel.numbers) {
        out.push({
          label: `${sel.exam} ${mockExamNumberIdToLabel(num)}`,
          textbook: sel.exam,
          variantTypes,
        });
      }
    }
    return out.length ? out : [{ label: '(번호 없음)', textbook: '', variantTypes }];
  }

  if (flow === 'unifiedVariant') {
    const entries = Array.isArray(meta.dbEntries) ? (meta.dbEntries as unknown[]) : [];
    const out: ExpandedItem[] = [];
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue;
      const en = e as Record<string, unknown>;
      const tb = typeof en.textbook === 'string' ? en.textbook : '';
      const sources = Array.isArray(en.selectedSources)
        ? (en.selectedSources as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      for (const src of sources) {
        out.push({ label: src, textbook: tb, variantTypes });
      }
    }
    return out.length ? out : [{ label: '(통합 항목 없음)', textbook: '', variantTypes }];
  }

  if (flow === 'workbook') {
    const tb = typeof meta.selectedTextbook === 'string' ? meta.selectedTextbook : '';
    const lessons = Array.isArray(meta.selectedLessons)
      ? (meta.selectedLessons as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const kind = typeof meta.workbookKind === 'string' ? meta.workbookKind : '';
    if (lessons.length === 0) {
      return [{ label: kind || '(워크북)', textbook: tb, variantTypes: '' }];
    }
    return lessons.map(label => ({ label, textbook: tb, variantTypes: kind }));
  }

  if (flow === 'vocabulary') {
    const items = Array.isArray(meta.items) ? (meta.items as unknown[]) : [];
    if (items.length === 0) {
      const tp = typeof meta.totalPrice === 'number' ? meta.totalPrice : null;
      return [{ label: tp != null ? `단어장 (${tp.toLocaleString()}원)` : '단어장', textbook: '', variantTypes: '' }];
    }
    const out: ExpandedItem[] = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const i = it as Record<string, unknown>;
      const tb = typeof i.textbook === 'string' ? i.textbook : '';
      const src = typeof i.sourceKey === 'string' ? i.sourceKey : (typeof i.label === 'string' ? i.label : '단어장 항목');
      out.push({ label: src, textbook: tb, variantTypes: '단어장' });
    }
    return out.length ? out : [{ label: '단어장', textbook: '', variantTypes: '' }];
  }

  return [{ label: '(분류 없음)', textbook: '', variantTypes }];
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const monthsParam = request.nextUrl.searchParams.get('months');
    const limitMonths = Math.min(60, Math.max(1, parseInt(monthsParam || '36', 10) || 36));

    const db = await getDb('gomijoshua');
    const orders = await db
      .collection('orders')
      .find({ status: 'completed' })
      .project({
        orderNumber: 1,
        completedAt: 1,
        createdAt: 1,
        loginId: 1,
        userId: 1,
        orderText: 1,
        revenueWon: 1,
        orderMeta: 1,
      })
      .sort({ completedAt: -1 })
      .toArray();

    interface OrderRow {
      월: string;
      완료일시: string;
      주문번호: string;
      회원ID: string;
      유형: string;
      교재: string;
      항목수: number;
      매출_원: number;
    }
    interface ItemRow {
      월: string;
      완료일시: string;
      주문번호: string;
      회원ID: string;
      유형: string;
      교재: string;
      항목: string;
      변형유형: string;
      단가추정_원: number;
    }

    const orderRows: OrderRow[] = [];
    const itemRows: ItemRow[] = [];

    for (const o of orders) {
      const ord = o as Record<string, unknown>;
      const monthKey = revenueMonthKeyForOrder({
        orderNumber: ord.orderNumber,
        completedAt: ord.completedAt,
      });
      if (!monthKey) continue;

      const total = effectiveOrderRevenueWon({
        revenueWon: ord.revenueWon,
        orderText: ord.orderText,
        orderMeta: ord.orderMeta,
      });

      const meta = (ord.orderMeta && typeof ord.orderMeta === 'object' && !Array.isArray(ord.orderMeta))
        ? (ord.orderMeta as Record<string, unknown>)
        : {};
      const flow = typeof meta.flow === 'string' ? meta.flow : '';

      const items = extractItems(meta, flow);
      const unitPrice = items.length > 0 ? Math.round(total / items.length) : total;

      const completedAt = dateString(ord.completedAt);
      const orderNumber = s(ord.orderNumber);
      const loginId = s(ord.loginId);
      const flowLbl = flowLabel(flow);
      const primaryTextbook = items[0]?.textbook ?? '';

      orderRows.push({
        월: monthKey,
        완료일시: completedAt,
        주문번호: orderNumber,
        회원ID: loginId,
        유형: flowLbl,
        교재: primaryTextbook,
        항목수: items.length,
        매출_원: total,
      });

      for (const it of items) {
        itemRows.push({
          월: monthKey,
          완료일시: completedAt,
          주문번호: orderNumber,
          회원ID: loginId,
          유형: flowLbl,
          교재: it.textbook,
          항목: it.label,
          변형유형: it.variantTypes,
          단가추정_원: unitPrice,
        });
      }
    }

    // 최근 N 개월로 자르기
    const allMonths = Array.from(new Set(orderRows.map(r => r.월))).sort((a, b) => b.localeCompare(a));
    const monthsKept = new Set(allMonths.slice(0, limitMonths));
    const orderFiltered = orderRows.filter(r => monthsKept.has(r.월));
    const itemFiltered = itemRows.filter(r => monthsKept.has(r.월));

    // 월별 요약
    interface SummaryRow { 월: string; 건수: number; 매출_원: number; }
    const summaryMap = new Map<string, SummaryRow>();
    for (const r of orderFiltered) {
      const cur = summaryMap.get(r.월) ?? { 월: r.월, 건수: 0, 매출_원: 0 };
      cur.건수 += 1;
      cur.매출_원 += r.매출_원;
      summaryMap.set(r.월, cur);
    }
    const summaryRows = Array.from(summaryMap.values()).sort((a, b) => b.월.localeCompare(a.월));

    // xlsx 생성
    const wb = XLSX.utils.book_new();
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, '월별 요약');
    const wsOrders = XLSX.utils.json_to_sheet(orderFiltered);
    XLSX.utils.book_append_sheet(wb, wsOrders, '주문');
    const wsItems = XLSX.utils.json_to_sheet(itemFiltered);
    XLSX.utils.book_append_sheet(wb, wsItems, '항목');

    const buf: Buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
    const ymd = new Date().toISOString().slice(0, 10);
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="revenue-detail-${ymd}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('revenue-by-month/detailed:', err);
    return NextResponse.json({ error: '내보내기 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
