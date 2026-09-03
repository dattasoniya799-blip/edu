/**
 * 环节② 课件讲解(原型 s-class-lecture):分页查看 + 打点小测软提示
 * 课件分页来自 join 快照的 courseware:
 * - 结构化页(title/body/narration,可带小测)按文字渲染;
 * - [2026-09-02 批准·走查 B-2] 教师挂的普通课件以 `resource{type,name,url}`(签名直链)下发,按类型渲染:
 *   image → img;pdf → 内嵌 iframe;video → video;interactive(单文件 HTML)→ 沙箱 iframe(allow-scripts,不许同源);
 *   ppt → 平板无法内嵌,给下载 / 新窗口打开。此前这些资源根本不下发,讲解环节永远「课件暂不可用」。
 * - 都没有 → 降级占位
 */
import { useState } from 'react';
import { Button, EmptyState, TexText, useToast } from '@qiming/ui';
import type { CoursewarePageView } from './types';

/** 按资源类型渲染课件正文(签名直链有效期约 10 分钟;过期由页面刷新拿新快照重签) */
function ResourceView({ res }: { res: NonNullable<CoursewarePageView['resource']> }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <EmptyState
        icon="🖼" text="课件加载失败" hint="直链可能已过期或文件不存在;刷新页面重新进入课堂即可重取" className="py-6"
        action={<a className="text-[13px] font-semibold text-primary hover:underline" href={res.url} target="_blank" rel="noopener noreferrer">在新窗口打开</a>}
      />
    );
  }
  switch (res.type) {
    case 'image':
      return <img src={res.url} alt={res.name} className="max-h-[520px] w-full rounded-md object-contain" onError={() => setBroken(true)} />;
    case 'pdf':
      return <iframe title={res.name} src={res.url} className="h-[520px] w-full rounded-md border border-line bg-card" onError={() => setBroken(true)} />;
    case 'video':
      return <video src={res.url} controls playsInline className="max-h-[520px] w-full rounded-md bg-ink" onError={() => setBroken(true)} />;
    case 'interactive':
      // 单文件交互 HTML:沙箱只放 scripts,不给同源 / 弹窗 / 表单,和实验区 validate-animations 的安全口径一致
      return <iframe title={res.name} src={res.url} sandbox="allow-scripts" className="h-[520px] w-full rounded-md border border-line bg-card" onError={() => setBroken(true)} />;
    default:
      return (
        <EmptyState
          icon="▣" text={res.name} hint="PPT 无法在平板内嵌播放,可下载或在新窗口打开" className="py-6"
          action={<a className="min-h-touch inline-flex items-center rounded-pill bg-primary px-4 text-[13px] font-semibold text-card" href={res.url} target="_blank" rel="noopener noreferrer">打开课件</a>}
        />
      );
  }
}

export interface LectureSegmentProps {
  pages: CoursewarePageView[];
  /** 活跃信号(心跳 idle 复位) */
  onTouch(): void;
  onDone(): void;
}

export function LectureSegment({ pages, onTouch, onDone }: LectureSegmentProps) {
  const { toast } = useToast();
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [quizState, setQuizState] = useState<'idle' | 'right' | 'wrong'>('idle');

  if (pages.length === 0) {
    return (
      <div className="mx-auto max-w-[860px] rounded-lg border border-line bg-card p-10 shadow-card">
        <EmptyState icon="▦" text="课件暂不可用" hint="老师还没有上传本节课件,可以先进入随堂练" />
        <div className="mt-4 flex justify-center">
          <Button variant="primary" className="min-h-touch" onClick={onDone}>进入随堂练 →</Button>
        </div>
      </div>
    );
  }

  const page = pages[idx];
  const quiz = page.quiz;

  const go = (d: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, idx + d));
    if (next === idx) return;
    setIdx(next);
    setPicked(null);
    setQuizState('idle');
    onTouch();
  };

  const check = () => {
    if (!quiz || !picked) { toast('先选一个答案哦'); return; }
    if (picked === quiz.correct) {
      setQuizState('right');
      toast('答对了!可以进入随堂练了');
    } else {
      setQuizState('wrong');
      toast(quiz.hint); // 软提示:不拦继续
    }
  };

  const finish = () => {
    if (quiz && quizState !== 'right') toast('小测还没答对哦——进入随堂练后可以随时问小启'); // 软提示
    onDone();
  };

  return (
    <div className="grid grid-cols-[1fr_300px] items-start gap-4">
      {/* 幻灯片 */}
      <div className="overflow-hidden rounded-lg border border-line bg-card shadow-card">
        {page.resource ? (
          <div className="flex min-h-[420px] flex-col gap-3 p-4">
            <div className="text-[15px] font-extrabold">{page.title}</div>
            <ResourceView res={page.resource} />
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 bg-gradient-to-br from-card to-primary-soft p-8 text-center">
            <div className="text-lg font-extrabold">{page.title}</div>
            <div className="max-w-[560px] text-[14.5px] leading-9 text-ink-2"><TexText src={page.body} /></div>
          </div>
        )}
        <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
          <Button className="min-h-touch" disabled={idx === 0} onClick={() => go(-1)}>← 上一页</Button>
          <span className="text-[12.5px] tabular-nums text-ink-2">第 {idx + 1} / {pages.length} 页(本环节节选)</span>
          <Button className="min-h-touch" disabled={idx === pages.length - 1} onClick={() => go(1)}>下一页 →</Button>
          <Button variant="primary" className="min-h-touch ml-auto !border-green !bg-green hover:!bg-green" onClick={finish}>
            完成讲解,进入随堂练 →
          </Button>
        </div>
      </div>

      {/* 右栏:旁白 + 打点小测 */}
      <div className="flex flex-col gap-3">
        {page.narration ? (
          <div className="flex items-start gap-2.5 rounded-md bg-gradient-to-br from-violet to-primary p-3.5 text-[13px] leading-6 text-card">
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-card/25 text-[13px]">✦</span>
            <span><TexText src={page.narration} /></span>
          </div>
        ) : (
          <div className="rounded-md border border-line bg-card p-3.5 text-[13px] leading-6 text-ink-2">
            跟着老师看课件;看完点「完成讲解」进入随堂练。有不懂的可以问右侧的 AI 助教。
          </div>
        )}
        {quiz && (
          <div className="rounded-md border-2 border-violet bg-card p-4 shadow-card">
            <div className="mb-2 text-[12.5px] font-bold text-violet">✦ 随堂小测 · 检验一下再继续</div>
            <div className="text-[13.5px] leading-7"><TexText src={quiz.stem} /></div>
            <div className="mt-2.5 flex flex-col gap-2">
              {quiz.options.map((o) => {
                const cls = quizState !== 'idle' && o.label === quiz.correct
                  ? 'border-green bg-green-soft'
                  : quizState === 'wrong' && picked === o.label
                    ? 'border-red bg-red-soft'
                    : picked === o.label
                      ? 'border-primary bg-primary-soft'
                      : 'border-line bg-card hover:border-ink-3';
                return (
                  <button key={o.label} type="button" disabled={quizState === 'right'}
                    onClick={() => { setPicked(o.label); setQuizState('idle'); onTouch(); }}
                    className={`min-h-touch flex items-center gap-2.5 rounded-[11px] border-[1.5px] px-3.5 text-left text-sm transition-all ${cls}`}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill border border-line bg-bg text-xs font-bold">{o.label}</span>
                    <TexText src={o.contentLatex} />
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={check} disabled={quizState === 'right'}
              className="min-h-touch mt-2.5 w-full rounded-[10px] bg-violet font-bold text-card transition-all disabled:opacity-50">
              {quizState === 'right' ? '✓ 已答对' : '确认'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
