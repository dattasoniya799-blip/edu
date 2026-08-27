import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

export type ToastVariant = 'info' | 'error' | 'success';

export interface ToastOptions {
  variant?: ToastVariant;
  /** 折行小字:契约特意下发的 ApiError.detail(缺哪几项、哪几份未复核…) */
  detail?: string;
  /** 自动消失毫秒数;缺省 info/success 2.4s、error 4s(错误文案更长,需要时间读) */
  duration?: number;
}

interface ToastCtx {
  /** 兼容单字符串调用:toast('已保存');需要变体/明细时 toast(msg, {variant, detail}) */
  toast: (message: string, opts?: ToastOptions) => void;
}

interface ToastState {
  message: string;
  variant: ToastVariant;
  detail?: string;
}

const Ctx = createContext<ToastCtx | null>(null);

const TONE: Record<ToastVariant, string> = {
  info: 'bg-ink text-card',
  error: 'bg-red text-card',
  success: 'bg-green text-card',
};

const DEFAULT_DURATION: Record<ToastVariant, number> = { info: 2400, success: 2400, error: 4000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((message: string, opts: ToastOptions = {}) => {
    const variant = opts.variant ?? 'info';
    setState({ message, variant, detail: opts.detail });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), opts.duration ?? DEFAULT_DURATION[variant]);
  }, []);
  const shown = state !== null;
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        aria-live={state?.variant === 'error' ? 'assertive' : 'polite'}
        role="status"
        className={`pointer-events-none fixed bottom-9 left-1/2 z-[60] max-w-[min(90vw,420px)] -translate-x-1/2 rounded-md px-5 py-2.5 text-[13px] font-medium shadow-card transition-all duration-200 ${
          TONE[state?.variant ?? 'info']
        } ${shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
      >
        {state?.message}
        {state?.detail && (
          <div className="mt-1 whitespace-pre-line break-words text-[12px] font-normal leading-relaxed opacity-80">
            {state.detail}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用');
  return ctx;
}
