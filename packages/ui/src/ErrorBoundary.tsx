import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义兜底页;缺省用内置的「页面出错了 + 刷新」 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 渲染期异常兜底。React 对未捕获的渲染异常会卸载整棵树 —— 表现为整站白屏且用户
 * 未保存的输入(如组卷已挑好的题)全部丢失。三端 main.tsx 各套一层,至少留住
 * 「出了什么错 + 刷新」这两条信息。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] 渲染期异常', error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <ErrorFallback error={error} />;
  }
}

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <div className="text-[40px] leading-none text-ink-3" aria-hidden="true">⚠</div>
      <h1 className="text-[17px] font-bold text-ink">页面出错了</h1>
      <p className="max-w-[420px] text-[13px] leading-relaxed text-ink-2">
        这一屏没能正常渲染,刷新一般就能恢复。若反复出现,请把下面这行信息告诉管理员。
      </p>
      <code className="max-w-[420px] break-all rounded-md bg-card px-3 py-2 text-[12px] text-ink-3">
        {error.message || String(error)}
      </code>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-[10px] border-[1.5px] border-primary bg-primary px-4 py-[9px] text-[13.5px] font-semibold text-card shadow-btn-sm hover:bg-primary-deep"
      >
        刷新页面
      </button>
    </div>
  );
}
