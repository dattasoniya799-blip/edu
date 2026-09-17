/**
 * 分组选择器(GroupedPicker)纯逻辑(vitest 覆盖)。
 *
 * 背景(用户报告 B/C):「挂载课件」「选择随堂练/课后作业试卷」两个弹窗此前都是一张平铺
 * 列表,东西一多就没法找。两处目录结构不同(资源按学科›年级›章节,试卷按学科›类型),
 * 但都是"逐级下拉收窄 + 关键词兜底"的同一种交互,故抽成一份路径无关的通用逻辑:
 * 每个候选项自带一条 `path`(已经按业务算好的目录路径),这里只管:
 *   ① 按已选的上级路径级联算出「下一级还有哪些选项」(可选项来自当前候选集,保序去重);
 *   ② 按各级选择 + 可选的次要类型(kind,如资源的 ppt/video/pdf/image)+ 关键词 一次性过滤到最终列表。
 * 各级选择清空规则由调用方(组件)在切换时把下级选择一并清空,这里只负责算选项与算结果。
 */

export interface GroupedItem {
  id: number;
  name: string;
  /** 副标题(如「3 题 · 20 分」「未发布」),纯展示 */
  meta?: string;
  /** 目录路径,如 ['数学','初二','第十九章'] 或 ['数学','随堂练'];各级允许为兜底文案如「未归类」 */
  path: readonly string[];
  /** 次要类型(如资源类型),配合 kindOf/kindOptions 做一次横向筛选;不传则不参与该筛选 */
  kind?: string;
}

/**
 * 某一级可选项:限定在「前面几级选择都命中」的候选集里,按该级取值去重、保序(首次出现顺序)。
 * `selected` 长度 = levelIndex,即到这一级为止已经选定的上级路径。
 */
export function optionsAtLevel(items: readonly GroupedItem[], selected: readonly string[]): string[] {
  const levelIndex = selected.length;
  const out: string[] = [];
  for (const it of items) {
    if (!selected.every((v, i) => v === '' || it.path[i] === v)) continue;
    const v = it.path[levelIndex];
    if (v != null && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 按已选路径(''=该级不限)+ 类型 + 关键词(匹配 name)过滤到最终候选 */
export function filterGroupedItems(
  items: readonly GroupedItem[],
  selected: readonly string[],
  kind: string,
  keyword: string,
): GroupedItem[] {
  const kw = keyword.trim().toLowerCase();
  return items.filter((it) => {
    if (!selected.every((v, i) => v === '' || it.path[i] === v)) return false;
    if (kind !== '' && it.kind !== kind) return false;
    if (kw !== '' && !it.name.toLowerCase().includes(kw)) return false;
    return true;
  });
}

/** 出现过的 kind 取值(按首次出现顺序去重),供类型筛选下拉;没有任何项带 kind → 空数组(调用方据此不渲染该筛选) */
export function kindsOf(items: readonly GroupedItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind != null && !out.includes(it.kind)) out.push(it.kind);
  }
  return out;
}
