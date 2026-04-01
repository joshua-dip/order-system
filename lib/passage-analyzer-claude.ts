import Anthropic from '@anthropic-ai/sdk';

export function getPassageAnalyzerAnthropic(): { anthropic: Anthropic; model: string } | { error: string } {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return { error: 'ANTHROPIC_API_KEY가 설정되어 있어야 합니다.' };
  }
  const model =
    (process.env.ANTHROPIC_SOLVE_MODEL && process.env.ANTHROPIC_SOLVE_MODEL.trim()) || 'claude-sonnet-4-20250514';
  return { anthropic: new Anthropic({ apiKey }), model };
}

export function stripJsonFence(text: string): string {
  let t = text.trim();
  if (t.startsWith('```json')) {
    t = t.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
  } else if (t.startsWith('```')) {
    t = t.replace(/```\n?/g, '').replace(/```\n?$/g, '');
  }
  return t.trim();
}
