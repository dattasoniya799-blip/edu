/**
 * 题干插图直传(/uploads/sts 两步流,契约形状同 A3 真实实现):
 *   1. POST /uploads/sts 取预签名凭证(走 contracts createClient)
 *   2. 对 uploadUrl 直接 PUT 文件体 —— 预签名直传不属于 openapi 契约接口,
 *      无法经 createClient 表达,此处是仓库内唯一允许的原生 fetch(mock 由 msw 拦截)
 */
import { api } from '../../../api';

export const MAX_FIGURE_BYTES = 2 * 1024 * 1024; // 原型口径:png / jpg / svg ≤ 2MB
export const ACCEPT_FIGURE = 'image/png,image/jpeg,image/svg+xml';

export function checkFigureFile(file: File): string | null {
  if (!ACCEPT_FIGURE.split(',').includes(file.type)) return '仅支持 png / jpg / svg 图片';
  if (file.size > MAX_FIGURE_BYTES) return '图片不能超过 2MB';
  return null;
}

/** 返回入库用 ossKey;任一步失败抛错 */
export async function uploadFigure(file: File): Promise<string> {
  const sts = await api.post('/uploads/sts', {
    body: { purpose: 'question_figure', fileName: file.name },
  });
  const { uploadUrl, ossKey } = sts.data;
  const res = await fetch(uploadUrl, { method: 'PUT', body: file });
  if (!res.ok) throw new Error(`图片直传失败(HTTP ${res.status})`);
  return ossKey;
}
