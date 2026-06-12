/**
 * 底部 AI 旁白条(原型 classFoot):violet→primary 渐变,narration 经 TexText 混排
 */
import { TexText } from '@qiming/ui';

export function ClassFoot({ narration }: { narration: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 bg-gradient-to-r from-violet to-primary px-4 py-2 text-[12.5px] text-card">
      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-card/25 text-xs">✦</span>
      <span className="min-w-0 truncate" data-testid="class-narration">
        {narration ? <TexText src={narration} /> : '小启在这里陪你上课,卡住了随时问我~'}
      </span>
    </div>
  );
}
