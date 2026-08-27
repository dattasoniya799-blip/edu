import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

export interface ModalProps {
  open: boolean;
  title?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, onClose, footer, children, width = 520 }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 打开时把焦点移进面板(首个可聚焦元素,没有就聚焦面板本体),关闭时还给打开弹窗的那个元素。
  // 否则键盘用户 Tab 会直接跑到弹窗背后的页面上继续操作。
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => restoreTo?.focus?.();
  }, [open]);

  // Tab 焦点圈:在面板内循环,不逃到背后的页面
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstEl || active === panel)) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus(); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        {...(title != null ? { 'aria-labelledby': titleId } : {})}
        tabIndex={-1}
        className="max-h-[86vh] w-full overflow-auto rounded-lg bg-card shadow-card outline-none"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          {title != null ? <h3 id={titleId} className="text-[15px] font-bold text-ink">{title}</h3> : <span />}
          <button type="button" aria-label="关闭" className="text-ink-3 hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2.5 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
