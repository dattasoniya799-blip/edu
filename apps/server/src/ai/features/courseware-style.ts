import type { CoursewareStyleInput } from '@qiming/contracts';
import { loadAiConfigJson } from '../config-loader';

/**
 * AI 生成课件 · PPT 风格提示词组装(服务端唯一事实)。
 *
 * 风格清单(5 套内置 promptTemplate + 自定义护栏文本)存 `src/ai/config/courseware-styles.json`,
 * 由 apps/teacher 的 `pages/courseware/lib/styles.ts` **原样搬运**(提示词不进代码,同 A7 约定);
 * 本文件只做与前端 `composeStylePrefix` / `composePagePrompt` **同构**的组装,
 * 使 mock 走查时看到的最终提示词与真实链路逐字一致。
 */

interface StylesConfig {
  defaultStyleId: string;
  customStyleId: string;
  customStyleName: string;
  customGuardrail: string;
  styles: { id: string; name: string; promptTemplate: string }[];
}

function config(): StylesConfig {
  return loadAiConfigJson<StylesConfig>('courseware-styles.json');
}

/** 内置风格清单(id + 展示名,不含提示词)—— 供出参/日志用,不外泄提示词 */
export function styleIds(): string[] {
  const c = config();
  return [...c.styles.map((s) => s.id), c.customStyleId];
}

/** 自定义风格的固定 id(前端同名常量 CUSTOM_STYLE_ID) */
export function customStyleId(): string {
  return config().customStyleId;
}

/**
 * 风格显示名(自定义风格带上老师描述的前 12 字,与前端 styleLabel 同口径)。
 * 未知 id 落默认风格名(防御性兜底,与前端 getStyle 一致)。
 */
export function styleLabel(choice: CoursewareStyleInput): string {
  const c = config();
  if (choice.id !== c.customStyleId) {
    const hit = c.styles.find((s) => s.id === choice.id);
    return (hit ?? c.styles[0]).name;
  }
  const t = (choice.customText ?? '').trim();
  return t ? `${c.customStyleName} · ${t.length > 12 ? `${t.slice(0, 12)}…` : t}` : c.customStyleName;
}

/**
 * 风格前缀(每页提示词的第一段),与前端 composeStylePrefix 同口径:
 * - 内置风格 → 该风格的 promptTemplate;
 * - 自定义风格 → 固定护栏 + 老师原文;
 * - 未知 id / 自定义但描述为空 → 退回默认风格模板(最后一道保险,保证不发出无风格提示词)。
 */
export function composeStylePrefix(styleId: string, customText?: string): string {
  const c = config();
  const fallback = () =>
    (c.styles.find((s) => s.id === c.defaultStyleId) ?? c.styles[0]).promptTemplate;
  if (styleId === c.customStyleId) {
    const t = (customText ?? '').trim();
    return t ? `${c.customGuardrail}\n${t}` : fallback();
  }
  const style = c.styles.find((s) => s.id === styleId);
  return style ? style.promptTemplate : fallback();
}

/**
 * 单页最终提示词 = 风格前缀 + 本页完整内容(标题 + 完整句要点 + 配图说明)+ 页码 n/N。
 * 与前端 composePagePrompt 逐字同构(前端 pages/courseware/lib/styles.ts)。
 * 注意:页码段的「n/N」标记也是 MockImageProvider 失败注入识别页序的依据。
 */
export function composePagePrompt(input: {
  style: CoursewareStyleInput;
  page: { title: string; body: string; imagePrompt: string };
  seq: number;
  total: number;
}): string {
  const { style, page, seq, total } = input;
  const bullets = page.body
    .split('\n')
    .map((l) => l.replace(/^[·•\-\s]+/, '').trim())
    .filter(Boolean)
    .map((l) => `- ${l}`)
    .join('\n');
  return [
    composeStylePrefix(style.id, style.customText),
    '',
    '【本页内容】',
    `页标题:${page.title.trim()}`,
    bullets ? `要点(逐条排版,保持完整句):\n${bullets}` : '要点:无',
    page.imagePrompt.trim() ? `配图与版式:${page.imagePrompt.trim()}` : '',
    `页码:右下角标注「${seq}/${total}」`,
  ]
    .filter(Boolean)
    .join('\n');
}
