/**
 * ossKey → 可加载图片 URL 的「单点」解析(REV-front #1)。
 *
 * 题目插图在题库里以 ossKey 存储,前端 <img src> 不能直接吃 ossKey。真实后端取图是
 * **异步两跳**:先带登录态调 `GET /api/v1/uploads/view-url?ossKey=` 拿 JSON `{url}`
 * (url 指向 @Public 的 /storage 签名直链),再把该直链放进 <img src>。该端点不属于
 * openapi 契约(见 server upload.controller),故由各端用自己的 createClient 注入一个
 * `ViewUrlFetcher`(带 token、走统一 401 处理),这里只负责「mock 占位 / 已是直链 /
 * 异步换签名直链 + 缓存」的解析编排。
 *
 *   ── 形态(2026-06 实测对接) ─────────────────────────────────────────
 *   - 已是可加载 URL(http/data/blob)→ 原样用(教师录题刚上传的本地 blob 预览即此类)
 *   - mock 模式 → 占位 SVG(data URL),无需任何网络请求
 *   - 真实模式 → resolveOssUrlAsync(ossKey, fetchViewUrl):异步取签名直链,按 ossKey 缓存
 *   ────────────────────────────────────────────────────────────────────
 */

/**
 * mock 模式判定(与三端 main.tsx 口径一致:仅 VITE_USE_MOCK === 'true' 即 mock,opt-in)。
 * 优先 vite 注入的 import.meta.env;无注入时(vitest node / SSR)兜底看 process.env —— 浏览器
 * 真实构建里 import.meta.env 必有值,不会走到 process.env 分支,故 prod 行为不变。
 */
function isMockMode(): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const flag = viteEnv?.VITE_USE_MOCK
    ?? (typeof process !== 'undefined' ? process.env?.VITE_USE_MOCK : undefined);
  return flag === 'true';
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
 * 各端注入:由 ossKey 取后端签名直链(走该端 createClient,带 token + 401 处理)。
 * 失败应自行 reject;调用方会吞为 null 并降级占位框。
 */
export type ViewUrlFetcher = (ossKey: string) => Promise<string>;

/** 插图源解析器:ossKey → 可加载 URL,可同步(直链/mock)也可异步(真实换签名直链) */
export type FigureSrcResolver = (ossKey: string) => string | null | Promise<string | null>;

/**
 * 同步解析:仅处理「已是直链」与「mock 占位」;真实模式的非直链 ossKey 需异步,这里返回
 * null(交给 resolveOssUrlAsync / QuestionFigures 的异步路径)。供无副作用渲染场景使用。
 */
export function resolveOssUrl(ossKey: string): string | null {
  if (!ossKey) return null;
  if (isLoadable(ossKey)) return ossKey;
  if (isMockMode()) return mockPlaceholder(ossKey);
  return null;
}

/** 按 ossKey 缓存换签名直链的 in-flight / 已完成 Promise,避免同图多次回签名 */
const viewUrlCache = new Map<string, Promise<string | null>>();

/**
 * 异步解析:已是直链 / mock 占位 → 立即 resolve;真实模式 → 经 fetchViewUrl 换签名直链
 * 并按 ossKey 缓存。fetchViewUrl 失败 → resolve(null)(渲染层降级为占位框,不抛)。
 */
export function resolveOssUrlAsync(ossKey: string, fetchViewUrl: ViewUrlFetcher): Promise<string | null> {
  if (!ossKey) return Promise.resolve(null);
  if (isLoadable(ossKey)) return Promise.resolve(ossKey);
  if (isMockMode()) return Promise.resolve(mockPlaceholder(ossKey));
  let p = viewUrlCache.get(ossKey);
  if (!p) {
    p = fetchViewUrl(ossKey)
      .then((u) => (u ? u : null))
      .catch(() => {
        // 失败不长期缓存:下次仍可重试
        viewUrlCache.delete(ossKey);
        return null;
      });
    viewUrlCache.set(ossKey, p);
  }
  return p;
}
