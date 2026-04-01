import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageAnalyzerAnthropic } from '@/lib/passage-analyzer-claude';
import {
  clampComprehensiveSlotCount,
  normalizeSlotOutputLangs,
  runComprehensiveAnalysis,
  runIndividualAnalysis,
} from '@/lib/passage-analyzer-comprehensive';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const claude = getPassageAnalyzerAnthropic();
  if ('error' in claude) {
    return NextResponse.json({ error: claude.error }, { status: 503 });
  }
  const { anthropic, model } = claude;

  try {
    const body = await request.json();
    const {
      passage,
      analysisType,
      customPrompt,
      customPrompts,
      outputLang: rawLang,
      outputLangBySlot: rawBySlot,
      slotCount: rawSlots,
    } = body;
    const legacyOutputLang = rawLang === 'en' ? 'en' : 'ko';
    const rawN =
      typeof rawSlots === 'number' && Number.isFinite(rawSlots)
        ? rawSlots
        : typeof rawSlots === 'string'
          ? parseInt(rawSlots, 10)
          : 5;
    const slotCount = clampComprehensiveSlotCount(Number.isFinite(rawN) ? rawN : 5);
    if (!passage || typeof passage !== 'string') {
      return NextResponse.json({ error: '지문이 필요합니다.' }, { status: 400 });
    }

    const bySlotOk =
      rawBySlot != null && typeof rawBySlot === 'object' && !Array.isArray(rawBySlot)
        ? (rawBySlot as Record<string, unknown>)
        : null;
    const slotOutputLangs = normalizeSlotOutputLangs(slotCount, bySlotOk, legacyOutputLang);

    let result: Record<string, unknown>;
    if (analysisType === 'all') {
      result = await runComprehensiveAnalysis(
        anthropic,
        model,
        passage,
        customPrompt,
        customPrompts,
        legacyOutputLang,
        slotOutputLangs,
        slotCount
      );
    } else {
      result = await runIndividualAnalysis(anthropic, model, passage, analysisType);
    }

    if ('error' in result && result.error) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('comprehensive-analysis:', e);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
