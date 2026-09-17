/**
 * html 动画 iframe 的两处兜底(README「已知待改」1:LLM 生成的 HTML 动画画面偏小)。
 *
 * 根因分三层(server 侧也各修了一层,这里管 web 端能管的两层):
 *  1. 卡片高度是写死的一个数(280px),跟卡片实际宽度(随列宽/缩放变化)对不上,容易比例失真;
 *  2. 有些旧动画(或没听话的新动画)canvas/svg 用 `height:auto` 或压根没写满容器的 CSS,
 *     内容就贴着一角、周围一大片空白——不管 server 端提示词多强调,存量剧本已经烤死在 state.json 里了。
 *
 * 这里做的事:iframe 高度按卡宽 16:10 算;srcDoc 注入一段 `!important` 基础 CSS 把 html/body/canvas/svg
 * 强制撑满 iframe——即使动画自己的 CSS 想留白,也盖不过 `!important`。这解决不了「画的内容本身只占
 * 画布一个角」这种构图问题(那是画布**内部**坐标怎么摆的问题,CSS 管不到),但能保证画布这个盒子本身
 * 不再比卡片小一圈,旧动画至少不会更差。
 */

export const ANIM_ASPECT_H_OVER_W = 10 / 16;

/** iframe 高度上下限(极端列宽/缩放下别变形太夸张) */
const MIN_H = 160;
const MAX_H = 560;

/** 按卡宽(CSS px)算 iframe 应该多高;量不到宽度时退回一个固定值 */
export function animIframeHeight(cardWidth: number | undefined | null): number {
  if (!Number.isFinite(cardWidth as number) || (cardWidth as number) <= 0) return 280;
  const h = (cardWidth as number) * ANIM_ASPECT_H_OVER_W;
  return Math.round(Math.min(MAX_H, Math.max(MIN_H, h)));
}

const BASE_CSS =
  '<style id="__lecture_base_css">' +
  'html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important}' +
  'canvas,svg{display:block!important;width:100%!important;height:100%!important}' +
  '</style>';

/** 把基础 CSS 插进 `<head>`(没有就插 `<html>` 开头,再没有就插 `<body>` 前,最后兜底直接前置) */
export function withBaseCss(html: string | undefined | null): string {
  const src = String(html ?? '');
  if (!src.trim()) return src;
  if (/<head[^>]*>/i.test(src)) return src.replace(/<head[^>]*>/i, (m) => `${m}${BASE_CSS}`);
  if (/<html[^>]*>/i.test(src)) return src.replace(/<html[^>]*>/i, (m) => `${m}${BASE_CSS}`);
  if (/<body[^>]*>/i.test(src)) return src.replace(/<body[^>]*>/i, (m) => `${BASE_CSS}${m}`);
  return `${BASE_CSS}${src}`;
}
