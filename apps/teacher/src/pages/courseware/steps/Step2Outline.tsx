/**
 * 向导第 2 步 · 逐页大纲编辑(由 CoursewareWizardPage 拆出)
 * 增删调序 + 逐页改写,输入框上限与后端 DTO 同数(见 lib/outline.ts LIMITS)。
 */
import { Fragment } from 'react';
import type { CoursewareOutlinePageDto, CoursewareStyleInput } from '@qiming/contracts';
import { Button, EmptyState, Tag } from '@qiming/ui';
import {
  LIMITS, canInsertPage, estimateSeconds, formatEstimate, insertPage, movePage, removePage, updatePage,
} from '../lib/outline';
import { styleLabel } from '../lib/styles';
import { FIELD_CLS, counterText, stylePreview } from './shared';

export interface Step2OutlineProps {
  pages: CoursewareOutlinePageDto[];
  onPages: (next: CoursewareOutlinePageDto[]) => void;
  styleId: string;
  style: CoursewareStyleInput;
  submitting: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

export function Step2Outline({ pages, onPages, styleId, style, submitting, onConfirm, onBack }: Step2OutlineProps) {
  const canInsert = canInsertPage(pages);
  const insertHint = canInsert ? undefined : `已达 ${LIMITS.pages} 页上限,删掉一页才能再插入`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-5 py-3.5 shadow-card">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <span className="flex items-center gap-1.5 rounded-pill bg-primary-soft px-2.5 py-1 text-[12.5px] font-semibold text-primary">
            <img src={stylePreview(styleId)} alt="" className="h-4 w-6 rounded-sm object-cover" />
            {styleLabel(style)}
          </span>
          共 <b className="tabular-nums text-ink">{pages.length}</b>/{LIMITS.pages} 页 ·
          可逐页改写标题 / 要点 / 画面描述,也可调序、删除、在任意位置插入新页
        </div>
        <Button onClick={onBack}>返回上一步 · 换风格 / 重新生成大纲</Button>
      </div>

      {pages.length === 0 ? (
        <div className="rounded-lg border border-line bg-card shadow-card">
          <EmptyState
            icon="▤" text="大纲是空的"
            hint="可返回第 1 步重新生成,或手动插入页"
            action={<Button variant="primary" onClick={() => onPages(insertPage(pages, 0))}>＋ 插入一页</Button>}
          />
        </div>
      ) : (
        <div className="flex flex-col">
          {pages.map((p, i) => (
            <Fragment key={`page-${i}`}>
              <InsertRow
                onClick={() => onPages(insertPage(pages, i))}
                label={i === 0 ? '在最前插入一页' : '在此处插入一页'}
                disabled={!canInsert}
                title={insertHint}
              />
              <div className="rounded-lg border border-line bg-card shadow-card">
                <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-pill bg-primary text-[13px] font-bold tabular-nums text-card">{i + 1}</span>
                  <b className="truncate text-[13.5px]">{p.title.trim() || <span className="text-ink-3">未命名页</span>}</b>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button" aria-label={`上移第 ${i + 1} 页`} disabled={i === 0}
                      onClick={() => onPages(movePage(pages, i, -1))}
                      className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[11px] text-ink-2 hover:border-primary hover:text-primary disabled:opacity-40"
                    >▲</button>
                    <button
                      type="button" aria-label={`下移第 ${i + 1} 页`} disabled={i === pages.length - 1}
                      onClick={() => onPages(movePage(pages, i, 1))}
                      className="flex h-6 w-6 items-center justify-center rounded-[7px] border border-line text-[11px] text-ink-2 hover:border-primary hover:text-primary disabled:opacity-40"
                    >▼</button>
                    <button
                      type="button" className="ml-1 text-[13px] font-medium text-red hover:underline"
                      onClick={() => onPages(removePage(pages, i))}
                    >删除本页</button>
                  </div>
                </div>
                <div className="flex flex-col gap-3 px-4 py-3.5">
                  <label className="flex flex-col gap-1.5">
                    <span className="flex justify-between text-[12.5px] font-semibold text-ink-2">
                      页标题
                      <span className="tabular-nums font-normal text-ink-3">{counterText(p.title.length, LIMITS.title)}</span>
                    </span>
                    <input
                      className={FIELD_CLS} value={p.title} maxLength={LIMITS.title}
                      onChange={(e) => onPages(updatePage(pages, i, { title: e.target.value }))}
                      aria-label={`第 ${i + 1} 页标题`}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="flex justify-between text-[12.5px] font-semibold text-ink-2">
                      要点文字(每行一条完整句,会写进幻灯片)
                      <span className="tabular-nums font-normal text-ink-3">{counterText(p.body.length, LIMITS.body)}</span>
                    </span>
                    <textarea
                      className={`min-h-[126px] resize-y ${FIELD_CLS} leading-relaxed`} value={p.body} maxLength={LIMITS.body}
                      onChange={(e) => onPages(updatePage(pages, i, { body: e.target.value }))}
                      aria-label={`第 ${i + 1} 页要点`}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="flex justify-between text-[12.5px] font-semibold text-ink-2">
                      <span className="flex items-center gap-1.5">画面描述 <Tag tone="violet">AI 生图提示词</Tag></span>
                      <span className="tabular-nums font-normal text-ink-3">{counterText(p.imagePrompt.length, LIMITS.imagePrompt)}</span>
                    </span>
                    <textarea
                      className={`min-h-[92px] resize-y ${FIELD_CLS} leading-relaxed`} value={p.imagePrompt} maxLength={LIMITS.imagePrompt}
                      onChange={(e) => onPages(updatePage(pages, i, { imagePrompt: e.target.value }))}
                      aria-label={`第 ${i + 1} 页画面描述`}
                    />
                  </label>
                </div>
              </div>
            </Fragment>
          ))}
          <InsertRow
            onClick={() => onPages(insertPage(pages, pages.length))}
            label="在末尾插入一页"
            disabled={!canInsert}
            title={insertHint}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3.5 rounded-lg border border-line bg-card px-5 py-4 shadow-card">
        <Button variant="primary" loading={submitting} disabled={pages.length === 0} onClick={onConfirm}>
          {submitting ? '提交中…' : `确认并生成 ${pages.length} 页课件`}
        </Button>
        <div className="text-[12.5px] text-ink-2">
          将调用 AI 逐页生成图片,{formatEstimate(estimateSeconds(pages.length))}({pages.length} × {estimateSeconds(1)} 秒)· 生成期间可离开本页
        </div>
      </div>
    </div>
  );
}

/** 页间插入位(点一下在此处插入一页;到 20 页上限后禁用) */
function InsertRow({ onClick, label, disabled, title }: { onClick: () => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="my-1.5 w-full rounded-[9px] border-[1.5px] border-dashed border-line py-1.5 text-[12.5px] font-semibold text-ink-3 hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line disabled:hover:text-ink-3"
    >
      ＋ {disabled && title ? title : label}
    </button>
  );
}
