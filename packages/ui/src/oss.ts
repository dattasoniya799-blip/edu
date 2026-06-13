/**
 * ossKey → 可加载图片 URL 的「单点」解析(FIX4-front #2,P1-4 前端侧)。
 *
 * 题目插图在题库里以 ossKey 存储,前端 <img src> 不能直接吃 ossKey。后端会提供
 * 「按 ossKey 取签名/直链」的方式;确切端点形状在整合时由协调者给出 —— 届时只需
 * 改本文件这一处(resolveOssUrl 的真实分支),所有渲染处(教师录题/学生作业/结果/
 * 错题/批改)自动生效。
 *
 *   ── 待对接(整合时) ───────────────────────────────────────────────
 *   真实模式当前按「后端提供一个按 ossKey 直接返回(签名)图片的 GET 端点,可直接
 *   放进 <img src>」的假设拼路径(OSS_SIGN_PATH)。若后端实际是「先调接口拿临时
 *   URL 再加载」的异步形态,则把本函数改为异步并相应调整 <QuestionFigures> 调用;
 *   若端点路径/参数不同,只改 OSS_SIGN_PATH 一行。
 *   ──────────────────────────────────────────────────────────────────
 */

/** 与 contracts createClient 默认 baseUrl 对齐 */
const OSS_SIGN_PATH = '/api/v1/files/sign';

/** mock 模式判定(与三端 main.tsx 口径一致:VITE_USE_MOCK !== 'false' 即 mock) */
function isMockMode(): boolean {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_USE_MOCK !== 'false';
}

/** 已经是浏览器可直接加载的 URL(签名直链 / data / blob)→ 原样用 */
function isLoadable(ossKey: string): boolean {
  return /^(https?:|data:|blob:)/.test(ossKey);
}

/** mock 下没有真实对象存储:生成一张占位 SVG(data URL),让插图「真实可见」而非占位框 */
function mockPlaceholder(ossKey: string): string {
  const name = (ossKey.split('/').pop() ?? ossKey).slice(0, 28);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="140">` +
    `<rect width="220" height="140" rx="8" fill="#EEF1FE"/>` +
    `<text x="110" y="60" font-family="sans-serif" font-size="30" fill="#4F6BF5" text-anchor="middle">⛶</text>` +
    `<text x="110" y="92" font-family="sans-serif" font-size="12" fill="#4F6BF5" text-anchor="middle">MOCK 插图</text>` +
    `<text x="110" y="112" font-family="sans-serif" font-size="10" fill="#8A90A6" text-anchor="middle">${name}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * 把题目插图 ossKey 解析为可加载 URL。
 * - 已是可加载 URL → 原样返回。
 * - mock 模式 → 占位 SVG data URL(可见)。
 * - 真实模式 → 后端按 ossKey 取(签名)图片的端点(待整合对接,见文件头)。
 */
export function resolveOssUrl(ossKey: string): string | null {
  if (!ossKey) return null;
  if (isLoadable(ossKey)) return ossKey;
  if (isMockMode()) return mockPlaceholder(ossKey);
  return `${OSS_SIGN_PATH}?ossKey=${encodeURIComponent(ossKey)}`;
}
