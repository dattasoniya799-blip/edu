/**
 * 题目插图渲染(方案 A,2026-06-13 批准):一张图通过 anchor 标明归属位置
 * (题干 / 选项 / 解析 / 参考答案 / 评分要点);缺省 anchor=题干,向后兼容旧数据。
 *
 * 教师端编辑器与学生端/课堂/错题本共用同一渲染口径 —— 都经本组件,避免各处重复。
 * mock 阶段 ossKey 无可签名 URL,降级为占位缩略框(与录题预览一致);
 * 真实后端经 resolveSrc 把 ossKey 解析为签名 URL 后即显示图片。
 */
import type { QuestionFigure } from '@qiming/contracts';
import { OssImage } from './OssImage';
import type { FigureSrcResolver } from './oss';

export type FigureTarget = NonNullable<QuestionFigure['anchor']>['target'];

/** 默认解析:ossKey 本身就是可直接加载的 URL(http/https/data/blob)才取,否则占位 */
export function defaultResolveSrc(ossKey: string): string | null {
  return /^(https?:|data:|blob:)/.test(ossKey) ? ossKey : null;
}

/** 取归属于某锚点的插图(按 position 升序);ref 省略=不限,传入则精确匹配(选项 label / rubric step) */
export function selectFigures(
  figures: QuestionFigure[] | undefined,
  target: FigureTarget,
  anchorRef?: string,
): QuestionFigure[] {
  return (figures ?? [])
    .filter((f) => {
      const t = f.anchor?.target ?? 'stem';
      if (t !== target) return false;
      if (anchorRef === undefined) return true;
      return f.anchor?.ref === anchorRef;
    })
    .slice()
    .sort((a, b) => a.position - b.position);
}

/** 是否存在任一插图归属于该锚点(用于条件渲染,避免空容器) */
export function hasFigureAt(
  figures: QuestionFigure[] | undefined,
  target: FigureTarget,
  anchorRef?: string,
): boolean {
  return selectFigures(figures, target, anchorRef).length > 0;
}

export interface QuestionFiguresProps {
  figures: QuestionFigure[] | undefined;
  target: FigureTarget;
  /** 选项 label / rubric step;省略=该锚点下全部 */
  anchorRef?: string;
  /**
   * ossKey → 可加载 URL(真实后端注入签名 URL);默认仅识别 http/data/blob。
   * 可同步(直链/mock)或异步(真实两跳换签名直链,见 oss.ts resolveOssUrlAsync)。
   */
  resolveSrc?: FigureSrcResolver;
  /** 紧凑模式:选项内联用更小的图 */
  compact?: boolean;
  className?: string;
}

/** 把归属某锚点的插图渲染出来;无图返回 null。每张图经 OssImage 异步解析 + loading 占位 */
export function QuestionFigures({
  figures, target, anchorRef, resolveSrc = defaultResolveSrc, compact, className,
}: QuestionFiguresProps) {
  const list = selectFigures(figures, target, anchorRef);
  if (list.length === 0) return null;
  const imgCls = compact ? 'max-h-[64px] rounded-md border border-line' : 'max-h-[180px] rounded-md border border-line';
  const box = compact ? 'h-[64px] w-20' : 'h-[120px] w-[160px]';
  return (
    <div className={`flex flex-wrap items-start gap-2.5 ${className ?? (compact ? 'mt-1.5' : 'mt-3')}`} data-figure-target={target}>
      {list.map((fig, i) => (
        <OssImage
          key={fig.ossKey + i}
          ossKey={fig.ossKey}
          alt={`图 ${i + 1}`}
          resolveSrc={resolveSrc}
          className={imgCls}
          boxClassName={box}
          compact={compact}
        />
      ))}
    </div>
  );
}
