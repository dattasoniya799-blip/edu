/**
 * FormulaKeypad · 平板友好的数学公式按键面板(FIX3 / 问题4)
 *
 * 背景:填空题答案常含分数/根号/上下标等,平板软键盘打不出来。提供屏幕上的
 * 数学符号/模板键盘,点按把 LaTeX 片段插入输入框(配合 <MathInput/> 的实时预览)。
 * 纯展示组件:不持有输入状态,只通过 onInsert 把片段交回上层;插入与光标计算见 insertSnippet。
 *
 * ⚠️ 判分口径风险(见 apps/student/README.md「FIX3 契约/口径风险」):本面板产出 LaTeX 串,
 * 而后端 blank 判分是纯文本归一化比对(去空格+全角转半角后逐字相等),两者可能对不上。
 * 前端按现有 texts[] 契约产出 LaTeX,口径变更交人工决策,不在前端擅自改判分。
 */
import { TexText } from './TexText';

/** 光标落点标记:插入后光标移到此处(并可包裹选中文本),实际插入前会被剥离 */
export const CARET_MARK = '‸';

export interface FormulaKey {
  /** 键面以公式渲染(KaTeX);与 text 二选一 */
  tex?: string;
  /** 键面以纯文本渲染 */
  text?: string;
  /** 插入的 LaTeX 片段,可含一个 CARET_MARK 指示光标落点 */
  insert: string;
  /** 无障碍标签 */
  aria: string;
}

export interface FormulaKeyGroup {
  title: string;
  keys: FormulaKey[];
}

/** K12 数学填空最常用的模板/运算/符号/希腊字母(裁剪为单屏可容纳的集合) */
export const KEYPAD_GROUPS: FormulaKeyGroup[] = [
  {
    title: '模板',
    keys: [
      { tex: '\\frac{\\square}{\\square}', insert: '\\frac{‸}{}', aria: '分数' },
      { tex: '\\sqrt{\\square}', insert: '\\sqrt{‸}', aria: '根号' },
      { tex: '\\sqrt[n]{\\square}', insert: '\\sqrt[‸]{}', aria: 'n 次根' },
      { tex: '\\square^{\\square}', insert: '^{‸}', aria: '上标' },
      { tex: '\\square_{\\square}', insert: '_{‸}', aria: '下标' },
      { tex: '|\\square|', insert: '|‸|', aria: '绝对值' },
      { tex: '(\\;)', insert: '(‸)', aria: '括号' },
    ],
  },
  {
    title: '运算',
    keys: [
      { text: '+', insert: '+', aria: '加' },
      { text: '−', insert: '-', aria: '减' },
      { tex: '\\times', insert: '\\times ', aria: '乘' },
      { tex: '\\div', insert: '\\div ', aria: '除' },
      { text: '=', insert: '=', aria: '等于' },
      { tex: '\\neq', insert: '\\neq ', aria: '不等于' },
      { tex: '\\leq', insert: '\\leq ', aria: '小于等于' },
      { tex: '\\geq', insert: '\\geq ', aria: '大于等于' },
      { tex: '\\pm', insert: '\\pm ', aria: '正负' },
      { tex: '\\approx', insert: '\\approx ', aria: '约等于' },
    ],
  },
  {
    title: '符号',
    keys: [
      { tex: '\\pi', insert: '\\pi ', aria: '圆周率 π' },
      { tex: '^{\\circ}', insert: '^{\\circ}', aria: '度' },
      { text: '%', insert: '\\%', aria: '百分号' },
      { tex: '\\infty', insert: '\\infty ', aria: '无穷' },
      { tex: '\\angle', insert: '\\angle ', aria: '角' },
      { tex: '\\triangle', insert: '\\triangle ', aria: '三角形' },
    ],
  },
  {
    title: '希腊字母',
    keys: [
      { tex: '\\alpha', insert: '\\alpha ', aria: 'alpha' },
      { tex: '\\beta', insert: '\\beta ', aria: 'beta' },
      { tex: '\\gamma', insert: '\\gamma ', aria: 'gamma' },
      { tex: '\\theta', insert: '\\theta ', aria: 'theta' },
      { tex: '\\lambda', insert: '\\lambda ', aria: 'lambda' },
      { tex: '\\mu', insert: '\\mu ', aria: 'mu' },
    ],
  },
];

/**
 * 纯函数:把片段插入字符串。
 * - 剥离 CARET_MARK,光标落到该处;无标记则落到插入末尾。
 * - 若存在选区(end>start)且片段含标记,选中文本被包进标记处(如选「1」按 √ → \sqrt{1})。
 */
export function insertSnippet(
  value: string,
  selStart: number,
  selEnd: number,
  snippet: string,
): { value: string; caret: number } {
  const len = value.length;
  const start = Math.max(0, Math.min(selStart, len));
  const end = Math.max(start, Math.min(selEnd, len));
  const selected = value.slice(start, end);
  const markerIdx = snippet.indexOf(CARET_MARK);

  let inserted: string;
  let caretInInserted: number;
  if (markerIdx >= 0) {
    const before = snippet.slice(0, markerIdx);
    const after = snippet.slice(markerIdx + CARET_MARK.length);
    inserted = before + selected + after;
    caretInInserted = before.length + selected.length;
  } else {
    inserted = snippet;
    caretInInserted = snippet.length;
  }
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    caret: start + caretInInserted,
  };
}

export interface FormulaKeypadProps {
  onInsert: (snippet: string) => void;
  disabled?: boolean;
  className?: string;
}

export function FormulaKeypad({ onInsert, disabled, className = '' }: FormulaKeypadProps) {
  return (
    <div
      role="group"
      aria-label="公式输入面板"
      className={`flex flex-col gap-2.5 rounded-md border border-line bg-bg/60 p-3 ${className}`}
    >
      {KEYPAD_GROUPS.map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold text-ink-3">{g.title}</span>
          <div className="flex flex-wrap gap-1.5">
            {g.keys.map((k, i) => (
              <button
                key={`${k.aria}-${i}`}
                type="button"
                disabled={disabled}
                aria-label={k.aria}
                title={k.aria}
                onClick={() => onInsert(k.insert)}
                className="min-h-touch flex min-w-[44px] items-center justify-center rounded-md border border-line bg-card px-2.5 text-sm text-ink transition-all hover:border-primary hover:bg-primary-soft disabled:opacity-50"
              >
                {k.tex ? <TexText src={`$${k.tex}$`} /> : <span className="font-mono">{k.text}</span>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
