/** 三步向导子组件共用的表单样式与风格缩略图缓存(CoursewareWizardPage 拆分后的公共件) */
import { stylePreviewSvg } from '../lib/stylePreview';

export const FIELD_CLS = 'rounded-[10px] border-[1.5px] border-line px-3 py-2 text-[13px] outline-none focus:border-primary';

/** 风格缩略图是纯函数产物,按 id 缓存,避免每次渲染重新拼 SVG 字符串 */
const PREVIEW_CACHE = new Map<string, string>();

export function stylePreview(styleId: string): string {
  const hit = PREVIEW_CACHE.get(styleId);
  if (hit) return hit;
  const uri = stylePreviewSvg(styleId);
  PREVIEW_CACHE.set(styleId, uri);
  return uri;
}

/** 输入框右下角的「已输入 n/上限」计数;超限标红,与提交前校验同一套上限 */
export function counterText(current: number, max: number): string {
  return `${current}/${max}`;
}
