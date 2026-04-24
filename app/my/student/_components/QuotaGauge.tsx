'use client';

interface QuotaGaugeProps {
  dayUsed: number;
  dailyLimit: number;
  dayRemaining: number;
}

export default function QuotaGauge({ dayUsed, dailyLimit, dayRemaining }: QuotaGaugeProps) {
  const pct = Math.min(100, (dayUsed / dailyLimit) * 100);
  const isLow = dayRemaining <= 1;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-slate-500">오늘 AI 사용</span>
        <span className={`text-xs font-semibold ${isLow ? 'text-orange-500' : 'text-slate-700'}`}>
          {dayUsed}/{dailyLimit}회 ({dayRemaining}회 남음)
        </span>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isLow ? 'bg-orange-500' : 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
