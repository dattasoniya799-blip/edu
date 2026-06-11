import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

interface ToastCtx {
  toast: (message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((message: string) => {
    setMsg(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed bottom-9 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-ink px-5 py-2.5 text-[13px] font-medium text-card shadow-card transition-all duration-200 ${
          msg ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
        }`}
      >
        {msg}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用');
  return ctx;
}
