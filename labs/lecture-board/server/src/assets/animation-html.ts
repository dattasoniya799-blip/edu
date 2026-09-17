/**
 * 通用 HTML 动画的三道校验(protocol.md「server 侧 html 动画校验」):
 *  1. 静态:≤ 30 KB、无网络/外链、暴露 window.lecture 并在 load 时 postMessage lecture:ready;
 *  2. 运行:Playwright headless 打开 srcDoc,3 s 内收到 ready 且无 pageerror / console.error;
 *  3. 动作:剧本里用到的每个 do.name 各发一次 lecture:do,不抛错。
 * 任一不过 → 重生成一次 → 再不过 → 降级成 static(一张不可交互的 SVG)。
 *
 * 静态扫描是纯函数(有单测);运行/动作两道要起浏览器,只在流水线里跑。
 */

/** 自包含 HTML 体积上限 */
export const HTML_MAX_BYTES = 30 * 1024
/** 等 lecture:ready 的时间 */
export const READY_TIMEOUT_MS = 3_000
/** 每个动作之后等一会儿看有没有报错 */
const ACTION_SETTLE_MS = 400

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bfetch\s*\(/, '用了 fetch(:动画必须完全离线'],
  [/XMLHttpRequest/, '用了 XMLHttpRequest:动画必须完全离线'],
  [/\bimport\s*\(/, '用了动态 import():动画必须自包含'],
  [/<script[^>]+\bsrc\s*=/i, '有外链 <script src=…>:动画必须自包含'],
  [/<link[^>]+\bhref\s*=/i, '有外链 <link href=…>:动画必须自包含'],
  [/https?:\/\//i, '出现了 http(s):// 地址:动画禁止访问网络(要内嵌图就用 data:)']
]

/** 有没有代码在响应尺寸变化(ResizeObserver / window resize / devicePixelRatio 重算) */
const HAS_RESIZE_HANDLING = /ResizeObserver|addEventListener\(\s*['"]resize['"]|onresize\s*=|devicePixelRatio/i

/**
 * 画布画偏小的老毛病(README「已知待改」1):`<canvas width="480" height="270">` 这种写了固定像素尺寸的
 * HTML 属性,又没有任何 resize 处理代码,画面就永远是那么大一块,缩在 iframe 左上角(canvas 属性尺寸
 * 才是它的绘图分辨率,CSS 宽高不会让内容跟着放大;svg 同理)。
 * 只要写了 resize 处理(哪怕 canvas 标签上仍带一个初始尺寸)就不算违规——那说明会在运行时重算。
 */
function checkCanvasSizing(html: string): string[] {
  if (HAS_RESIZE_HANDLING.test(html)) return []
  const tags = html.match(/<(canvas|svg)\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const hasWidth = /\bwidth\s*=\s*["']?\d+/i.test(tag)
    const hasHeight = /\bheight\s*=\s*["']?\d+/i.test(tag)
    if (hasWidth && hasHeight) {
      const el = tag.match(/<(canvas|svg)/i)?.[1]?.toLowerCase() ?? 'canvas'
      return [
        `${el}标签写了固定像素尺寸(如 width="480" height="270")又没有 resize 处理:画面会缩在一角,不会随卡片放大;` +
          `请让 ${el} 占满容器(CSS 100%/100vw×100vh),用 ResizeObserver 或 window resize 监听重新计算尺寸与 DPR,坐标按容器尺寸的相对比例画`
      ]
    }
  }
  return []
}

/** 第一道:静态扫描。返回问题列表,空 = 通过 */
export function checkHtmlStatic(html: string): string[] {
  const issues: string[] = []
  const src = String(html ?? '')
  if (!src.trim()) return ['动画 HTML 是空的']
  const bytes = Buffer.byteLength(src, 'utf8')
  if (bytes > HTML_MAX_BYTES) issues.push(`动画 HTML ${(bytes / 1024).toFixed(1)} KB,超过 ${HTML_MAX_BYTES / 1024} KB 上限`)
  for (const [re, message] of FORBIDDEN) if (re.test(src)) issues.push(message)
  if (!/window\.lecture/.test(src)) issues.push('没有在 window.lecture 上暴露 { do, unlock, reset }')
  if (!/lecture:ready/.test(src)) issues.push('加载完没有 postMessage { type: "lecture:ready" }')
  issues.push(...checkCanvasSizing(src))
  return issues
}

function escapeXml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 两次都没过时的降级:一张米白纸底、写着这张动画本来要演示什么的静态 SVG */
export function fallbackSvg(purpose: string, note = '动画生成失败,已降级为静态说明'): string {
  const text = String(purpose ?? '').trim() || '这一步的演示'
  const perLine = 18
  const lines: string[] = []
  for (let i = 0; i < text.length && lines.length < 5; i += perLine) lines.push(text.slice(i, i + perLine))
  const tspans = lines
    .map((line, i) => `<tspan x="240" dy="${i === 0 ? 0 : 30}">${escapeXml(line)}</tspan>`)
    .join('')
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270" role="img">',
    '<rect width="480" height="270" rx="12" fill="#faf7f0" stroke="#d9d2c4"/>',
    '<circle cx="240" cy="70" r="26" fill="none" stroke="#c0b6a0" stroke-width="3"/>',
    '<path d="M228 70 l9 9 l16 -18" fill="none" stroke="#c0b6a0" stroke-width="3" stroke-linecap="round"/>',
    `<text x="240" y="130" text-anchor="middle" font-size="19" fill="#3a3a3a" font-family="sans-serif">${tspans}</text>`,
    `<text x="240" y="248" text-anchor="middle" font-size="13" fill="#9a9184" font-family="sans-serif">${escapeXml(note)}</text>`,
    '</svg>'
  ].join('')
}

export interface HtmlRuntimeResult {
  ok: boolean
  issues: string[]
}

/**
 * 第二、三道:无头浏览器跑一遍。
 * Playwright 起不来(没装 chromium)时返回 ok:false 并说明,由调用方决定降级。
 */
export async function checkHtmlRuntime(html: string, actionNames: string[]): Promise<HtmlRuntimeResult> {
  const issues: string[] = []
  let browser: import('playwright').Browser | null = null
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(`页面报错:${String(err.message).slice(0, 160)}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error:${msg.text().slice(0, 160)}`)
    })

    // 宿主页收 iframe 的 postMessage;与 web 端 sandbox="allow-scripts" 的形状一致
    await page.setContent(
      `<!doctype html><body style="margin:0">
       <iframe id="f" sandbox="allow-scripts" style="width:480px;height:320px;border:0"></iframe>
       <script>
         window.__ready = false; window.__errs = [];
         addEventListener('message', (e) => {
           const d = e.data || {};
           if (d.type === 'lecture:ready') window.__ready = true;
           if (d.type === 'lecture:error') window.__errs.push(String(d.message || 'lecture:error'));
         });
       </script></body>`,
      { waitUntil: 'load' }
    )
    await page.evaluate((srcdoc: string) => {
      const frame = document.getElementById('f') as HTMLIFrameElement
      frame.srcdoc = srcdoc
    }, html)

    const ready = await page
      .waitForFunction(() => (window as unknown as { __ready: boolean }).__ready === true, undefined, { timeout: READY_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false)
    if (!ready) issues.push(`${READY_TIMEOUT_MS / 1000} s 内没有收到 lecture:ready`)

    if (ready) {
      for (const name of actionNames) {
        await page.evaluate((actionName: string) => {
          const frame = document.getElementById('f') as HTMLIFrameElement
          frame.contentWindow?.postMessage({ type: 'lecture:do', name: actionName, params: {} }, '*')
        }, name)
        await page.waitForTimeout(ACTION_SETTLE_MS)
        if (errors.length) {
          issues.push(`发动作 ${name} 时出错:${errors[errors.length - 1]}`)
          break
        }
      }
    }

    const reported = (await page.evaluate(() => (window as unknown as { __errs: string[] }).__errs)) as string[]
    for (const e of reported) issues.push(`动画自报错误:${e}`)
    for (const e of errors) if (!issues.some((i) => i.includes(e))) issues.push(e)
    return { ok: issues.length === 0, issues }
  } catch (error) {
    return { ok: false, issues: [`无头校验跑不起来:${(error as Error).message.slice(0, 160)}`] }
  } finally {
    await browser?.close().catch(() => undefined)
  }
}
