/**
 * AnalysisView · 三种解析展示(C2 #7 展示侧)
 *
 * 简单 / 正常 / 详细 三档解析,默认显示「正常解析」;提供切换看简单/详细。
 * 「有哪个显示哪个,空的不显示」:仅渲染非空档位;全空 → 不渲染。
 * 单档时不显示切换条。数学/Markdown 统一走 TexText。可点目标 ≥44px(min-h-touch)。
 */
import { useMemo, useState } from 'react';
import { TexText } from './TexText';

export interface AnalysisViewProps {
  brief?: string | null;
  /** 正常解析(默认档) */
  normal?: string | null;
  detail?: string | null;
  /** 解析下方附加内容(如插图),随当前档位无关地展示 */
  extra?: React.ReactNode;
  className?: string;
}

const VARIANTS = [
  { key: 'brief', label: '简单解析' },
  { key: 'normal', label: '正常解析' },
  { key: 'detail', label: '详细解析' },
] as const;
export type AnalysisVariantKey = (typeof VARIANTS)[number]['key'];

/** 非空档位(保持 简单→正常→详细 顺序);全空 → []。纯函数,便于单测 */
export function availableAnalyses(
  v: { brief?: string | null; normal?: string | null; detail?: string | null },
): { key: AnalysisVariantKey; label: string }[] {
  return VARIANTS.filter((x) => (v[x.key] ?? '').trim() !== '').map((x) => ({ key: x.key, label: x.label }));
}

/** 当前档:优先选中态,否则「正常」,否则首个可用 */
export function resolveActiveAnalysis(
  available: { key: AnalysisVariantKey }[],
  active: AnalysisVariantKey,
): AnalysisVariantKey | null {
  if (available.length === 0) return null;
  return (available.find((v) => v.key === active)?.key)
    ?? (available.find((v) => v.key === 'normal')?.key)
    ?? available[0].key;
}

export function AnalysisView({ brief, normal, detail, extra, className = '' }: AnalysisViewProps) {
  const values: Record<AnalysisVariantKey, string | null | undefined> = { brief, normal, detail };
  const available = useMemo(() => availableAnalyses({ brief, normal, detail }), [brief, normal, detail]);
  const [active, setActive] = useState<AnalysisVariantKey>('normal');

  const current = resolveActiveAnalysis(available, active);
  if (current == null) return null;

  return (
    <div className={`rounded-md bg-bg/60 p-3.5 text-[13px] leading-7 text-ink-2 ${className}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <b className="text-ink">解析</b>
        {available.length > 1 && (
          <div className="ml-auto inline-flex flex-wrap gap-1" role="tablist" aria-label="解析详略切换">
            {available.map((v) => {
              const on = v.key === current;
              return (
                <button
                  key={v.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setActive(v.key)}
                  className={`min-h-touch rounded-[8px] border-[1.5px] px-3 text-[12.5px] font-semibold transition-colors ${
                    on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-2 hover:border-ink-3'
                  }`}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <TexText src={values[current] ?? ''} />
      {extra}
    </div>
  );
}
