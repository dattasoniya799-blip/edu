/**
 * 分组选择器(B/C:挂载课件 / 选择随堂练·课后作业试卷两个弹窗共用)。
 *
 * 此前两个弹窗都是一张平铺列表(东西一多就找不到);现在按调用方给的目录路径逐级下拉收窄
 * (资源:学科›年级›章节;试卷:学科›类型),可选叠加一层「类型」筛选(如资源的
 * ppt/video/pdf/image),再叠加关键词搜索。纯 UI + 级联逻辑,不知道自己在挂课件还是选卷——
 * 具体目录路径怎么算(资源/试卷各自的分组规则)由调用方在 `lesson/lib/kpDirectory.ts` 算好,
 * 这里只管「选中一条路径 → 缩小候选 → 点条目回调」。
 */
import { useState } from 'react';
import { filterGroupedItems, kindsOf, optionsAtLevel, type GroupedItem } from './lib/groupedPicker';

export type { GroupedItem };

const SELECT_CLS = 'rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2 text-[13px] focus:border-primary focus:outline-none';

export interface GroupedPickerProps {
  items: GroupedItem[];
  /** 各级下拉的 aria-label 前缀,如 ['学科','年级','章节'] 或 ['学科','类型'] */
  levelLabels: string[];
  /** 类型筛选(如资源的 ppt/video/pdf/image)的 aria-label 前缀;不传或没有任何项带 kind → 不渲染该筛选 */
  kindLabel?: string;
  /** kind 原始值(如 'ppt')→ 中文展示;缺省原样显示 */
  kindOptionLabels?: Record<string, string>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  emptyText: string;
  keywordPlaceholder?: string;
}

export function GroupedPicker({
  items, levelLabels, kindLabel, kindOptionLabels, selectedId, onSelect, emptyText,
  keywordPlaceholder = '按名称搜索…',
}: GroupedPickerProps) {
  const [selections, setSelections] = useState<string[]>(() => levelLabels.map(() => ''));
  const [kind, setKind] = useState('');
  const [keyword, setKeyword] = useState('');

  const setLevel = (i: number, value: string) => {
    // 改上级选择 → 下级选择一并清空,避免残留一个在新分组里不存在的下级值
    setSelections((prev) => prev.map((v, j) => (j < i ? v : j === i ? value : '')));
  };

  const kindOptions = kindLabel ? kindsOf(items) : [];
  const shown = filterGroupedItems(items, selections, kind, keyword);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2.5">
        {levelLabels.map((label, i) => {
          const options = optionsAtLevel(items, selections.slice(0, i));
          if (options.length === 0) return null; // 上级还没选到能再细分的程度,不渲染空壳下拉
          return (
            <select
              key={label}
              className={SELECT_CLS}
              value={selections[i]}
              onChange={(e) => setLevel(i, e.target.value)}
              aria-label={label}
            >
              <option value="">全部{label}</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        })}
        {kindOptions.length > 0 && (
          <select
            className={SELECT_CLS}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label={kindLabel}
          >
            <option value="">全部{kindLabel}</option>
            {kindOptions.map((k) => <option key={k} value={k}>{kindOptionLabels?.[k] ?? k}</option>)}
          </select>
        )}
        <input
          className="min-w-[160px] flex-1 rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
          placeholder={keywordPlaceholder}
          aria-label="关键词搜索"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      {shown.length === 0 ? (
        <div className="rounded-md bg-bg px-3.5 py-6 text-center text-[13px] text-ink-3">{emptyText}</div>
      ) : (
        <div className="flex max-h-[46vh] flex-col gap-2 overflow-auto pr-1">
          {shown.map((it) => {
            const selected = selectedId === it.id;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onSelect(it.id)}
                className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                  selected ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                }`}
              >
                <span>{it.name}</span>
                {it.meta && <small className="ml-2 shrink-0 text-xs text-ink-3">{it.meta}</small>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
