/**
 * 向导第 1 步 · 输入文字稿 / 内容范围 + 选 PPT 风格(由 CoursewareWizardPage 拆出)
 * 纯受控展示组件:所有状态在父页,这里只负责表单与上限提示。
 */
import type { CoursewareStyleInput } from '@qiming/contracts';
import { Button, Card, Skeleton, Tag } from '@qiming/ui';
import {
  LIMITS, PAGE_COUNT_MAX, PAGE_COUNT_MIN, clampPageCount, estimateSeconds, formatEstimate,
} from '../lib/outline';
import { CUSTOM_STYLE_ID, STYLE_CARDS, styleLabel } from '../lib/styles';
import type { CoursewareStyle } from '../lib/styles';
import { FIELD_CLS, counterText, stylePreview } from './shared';

const SOURCE_PLACEHOLDER = `粘贴文字稿,或写清本节课的内容范围。例:
本节课讲勾股定理。先由校园旗杆影长问题引入,回顾直角三角形三边关系;
推导 a²+b²=c²(面积拼图法);配两道例题(已知两边求第三边、判定直角三角形);
最后分层练习与小结,作业为课本第 28 页 1–3 题。`;
const CUSTOM_STYLE_PLACEHOLDER = `用你自己的话描述想要的视觉主题即可。例:
温暖的水彩画风,柔和的粉蓝色调`;

export interface Step1InputProps {
  name: string;
  onName: (v: string) => void;
  sourceText: string;
  onSourceText: (v: string) => void;
  pageCount: number;
  onPageCount: (v: number) => void;
  styleId: string;
  onStyleId: (v: string) => void;
  customText: string;
  onCustomText: (v: string) => void;
  style: CoursewareStyleInput;
  outlining: boolean;
  onGenerate: () => void;
}

export function Step1Input({
  name, onName, sourceText, onSourceText, pageCount, onPageCount,
  styleId, onStyleId, customText, onCustomText, style, outlining, onGenerate,
}: Step1InputProps) {
  return (
    <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
      <div className="flex flex-col gap-3.5">
        <Card title="第 1 步 · 输入文字稿 / 内容范围">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">课件名称 <span className="text-red">*</span></span>
              <input
                className={FIELD_CLS}
                value={name}
                maxLength={LIMITS.name}
                onChange={(e) => onName(e.target.value)}
                placeholder="如:第5讲 · 勾股定理(AI 生成)"
                aria-label="课件名称"
              />
              <span className="self-end text-xs tabular-nums text-ink-3">{counterText(name.length, LIMITS.name)}</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">文字稿 / 本节课内容范围 <span className="text-red">*</span></span>
              <textarea
                className={`min-h-[190px] resize-y ${FIELD_CLS} leading-relaxed`}
                value={sourceText}
                maxLength={LIMITS.sourceText}
                onChange={(e) => onSourceText(e.target.value)}
                placeholder={SOURCE_PLACEHOLDER}
                aria-label="文字稿或本节课内容范围"
              />
              <span className="flex justify-between text-xs text-ink-3">
                <span>写得越具体,大纲越贴合课堂节奏</span>
                <span className="tabular-nums">{counterText(sourceText.length, LIMITS.sourceText)}</span>
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold">期望页数</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={PAGE_COUNT_MIN}
                  max={PAGE_COUNT_MAX}
                  className={`w-20 text-center tabular-nums ${FIELD_CLS}`}
                  value={pageCount}
                  onChange={(e) => onPageCount(Number(e.target.value))}
                  onBlur={() => onPageCount(clampPageCount(pageCount))}
                  aria-label="期望页数"
                />
                <span className="text-[12.5px] text-ink-3">页(范围 {PAGE_COUNT_MIN}–{PAGE_COUNT_MAX};大纲仍可增删页)</span>
              </span>
            </label>
          </div>
        </Card>

        <Card title={<span>PPT 风格 <span className="text-[12px] font-normal text-ink-3">(决定整套课件的视觉风格,逐页统一)</span></span>}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
              {STYLE_CARDS.map((s) => (
                <StyleCard key={s.id} style={s} selected={styleId === s.id} onSelect={() => onStyleId(s.id)} />
              ))}
            </div>
            {styleId === CUSTOM_STYLE_ID && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold text-ink-2">
                  描述你想要的视觉风格 <span className="text-red">*</span>
                </span>
                <textarea
                  className={`min-h-[76px] resize-y ${FIELD_CLS} leading-relaxed`}
                  value={customText}
                  maxLength={LIMITS.customText}
                  onChange={(e) => onCustomText(e.target.value)}
                  placeholder={CUSTOM_STYLE_PLACEHOLDER}
                  aria-label="自定义风格描述"
                />
                <span className="flex justify-between text-xs text-ink-3">
                  <span>
                    只描述观感(配色、材质、装饰语汇);版面骨架(横版、标题+要点层级、讲解性配图、中文准确)由系统固定,不受影响。
                  </span>
                  <span className="tabular-nums">{counterText(customText.length, LIMITS.customText)}</span>
                </span>
              </label>
            )}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3.5 rounded-lg border border-line bg-card px-5 py-4 shadow-card">
          {outlining ? (
            <div className="flex w-full flex-col gap-2.5">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-violet">
                <Tag tone="violet">AI</Tag>正在阅读文字稿并规划逐页大纲,通常需要数秒…
              </div>
              <Skeleton lines={4} className="h-12 w-full" />
            </div>
          ) : (
            <>
              <Button variant="primary" onClick={onGenerate}>生成大纲</Button>
              <div className="text-[12.5px] text-ink-2">当前风格:<b className="text-ink">{styleLabel(style)}</b></div>
            </>
          )}
        </div>
      </div>

      <Card title="生成流程">
        <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-ink-2">
          <div>① 文本 AI 先出逐页大纲(标题 / 要点 / 画面描述),几秒即可。</div>
          <div>② 你逐页确认或改写 —— 这一步决定成品质量。</div>
          <div>③ 确认后逐页生成整张幻灯片图片,每页约 {formatEstimate(estimateSeconds(1))},过程中可离开本页稍后回来查看。</div>
          <div>④ 全部生成完成后自动落资源库(课件类型),可在编排课堂时挂到讲解环节。</div>
          <div className="border-t border-line pt-2.5">风格在这一步选定,整套课件逐页沿用同一套版式与配色;不满意可回到第 1 步换风格重新生成。</div>
        </div>
      </Card>
    </div>
  );
}

/** 风格卡片:迷你幻灯片缩略图 + 风格名 + 一句话定位 */
function StyleCard({ style, selected, onSelect }: { style: CoursewareStyle; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col gap-2 rounded-lg border-[1.5px] p-2 text-left ${
        selected ? 'border-primary bg-primary-soft' : 'border-line bg-card hover:border-primary'
      }`}
    >
      <img
        src={stylePreview(style.id)}
        alt={`${style.name}风格示意`}
        className="aspect-[1264/848] w-full rounded-md border border-line object-cover"
      />
      <div className="flex flex-col gap-0.5 px-0.5 pb-0.5">
        <div className="flex items-center gap-1.5 text-[13px] font-bold">
          {style.name}
          {selected && <span className="text-primary">✓</span>}
        </div>
        <div className="text-[11.5px] leading-snug text-ink-3">{style.tagline}</div>
        <div className="text-[11.5px] leading-snug text-ink-3">适合:{style.suit}</div>
      </div>
    </button>
  );
}
