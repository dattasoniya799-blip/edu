/**
 * MathInput · 平板友好的公式输入框(FIX3 / 问题4 MVP)
 *
 * 组成:普通文本输入框(键盘仍可直接打简单答案,如 y=2x+1)+「公式」按钮唤起
 * <FormulaKeypad/> 点按插入 LaTeX 片段 + <TexText/> 实时预览所输公式。
 * 受控:value/onChange 由上层持有(写入作答 response.texts[i])。
 * 光标:记录输入框选区,插入片段后用 useLayoutEffect 把光标移到模板的占位处。
 *
 * 选型说明见 FormulaKeypad.tsx 头注与 apps/student/README.md(MVP=公式按键面板)。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { FormulaKeypad, insertSnippet } from './FormulaKeypad';
import { TexText } from './TexText';

/** SSR(测试用 renderToStaticMarkup)下 useLayoutEffect 无效且会告警,退化为 useEffect */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface MathInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

export function MathInput({ value, onChange, disabled, placeholder, id, ariaLabel, className = '' }: MathInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sel = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
  const pendingCaret = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useIsoLayoutEffect(() => {
    const c = pendingCaret.current;
    if (c != null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(c, c);
      sel.current = { start: c, end: c };
      pendingCaret.current = null;
    }
  });

  const captureSel = () => {
    const el = inputRef.current;
    if (el) sel.current = { start: el.selectionStart ?? value.length, end: el.selectionEnd ?? value.length };
  };

  const handleInsert = (snippet: string) => {
    if (disabled) return;
    const r = insertSnippet(value, sel.current.start, sel.current.end, snippet);
    pendingCaret.current = r.caret;
    onChange(r.value);
  };

  const showPreview = value.trim() !== '';

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={id}
          aria-label={ariaLabel}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            captureSel();
          }}
          onSelect={captureSel}
          onKeyUp={captureSel}
          onClick={captureSel}
          className="min-h-touch w-full max-w-[420px] rounded-[10px] border-[1.5px] border-line bg-card px-3.5 text-sm text-ink outline-none transition-all focus:border-primary disabled:bg-bg"
        />
        {!disabled && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className={`min-h-touch shrink-0 rounded-[10px] border-[1.5px] px-3 text-[13px] font-semibold transition-all ${
              open ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-card text-ink-2 hover:border-primary'
            }`}
          >
            <span aria-hidden className="mr-1 font-serif italic">fx</span>公式
          </button>
        )}
      </div>

      {showPreview && (
        <div className="flex min-h-[28px] items-center gap-2 text-sm leading-7 text-ink-2">
          <span className="shrink-0 text-[11px] text-ink-3">预览</span>
          <TexText src={`$${value}$`} />
        </div>
      )}

      {open && !disabled && (
        <div id={panelId}>
          <FormulaKeypad onInsert={handleInsert} />
        </div>
      )}
    </div>
  );
}
