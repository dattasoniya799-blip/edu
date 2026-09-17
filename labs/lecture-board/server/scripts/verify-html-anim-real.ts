/**
 * 一次性真接口验证脚本(README「运行问题复查」用):
 * 用改过的 HTML_SYSTEM_PROMPT(server/src/assets/animation.ts)对着一道真题(滑轮组,复用
 * data/lessons/20260917-122617-xn9a 的题干/答案/purpose/actionNames)现场生成一次动画 HTML,
 * 跑三道校验(含新加的画布尺寸检查),再量一下画的内容占画布的比例——验证「坐标按比例算,
 * 别写死一堆小尺寸绝对像素」这条新纪律真的让模型改了写法,不只是嘴上说说。
 *
 * 只调一次模型(纯文字,不带图、不接 TTS/Seedream),算本次任务允许的 3 次真接口调用之一。
 * 跑法:npx tsx scripts/verify-html-anim-real.ts
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { buildHtmlAnimation } from '../src/assets/animation'
import { checkHtmlStatic } from '../src/assets/animation-html'
import { bailianKey, BAILIAN_BASE_URL, BAILIAN_CHAT_MODEL, LESSONS_ROOT } from '../src/config'
import { createOpenAICompatChatPort } from '../src/openai-compat-chat'

const HERE = dirname(fileURLToPath(import.meta.url))

async function main() {
  const lessonDir = resolve(LESSONS_ROOT, '20260917-122617-xn9a')
  const state = JSON.parse(readFileSync(resolve(lessonDir, 'state.json'), 'utf8'))
  const script = state.script
  const oldAnim = script.animations.find((a: { id: string }) => a.id === 'a_pulley')

  const port = createOpenAICompatChatPort({
    id: 'bailian',
    baseUrl: BAILIAN_BASE_URL,
    apiKey: bailianKey(),
    model: BAILIAN_CHAT_MODEL,
    supportsVision: false
  })

  console.log('旧版 purpose(混了动作名,已被 sanitizePurpose 净化,这里只是给模型看的原始素材):')
  console.log(' ', oldAnim.purpose.slice(0, 60))
  console.log('用改过的 HTML_SYSTEM_PROMPT 现场生成一次…')

  const result = await buildHtmlAnimation(port, {
    purpose: '演示滑轮组结构,展示物体上升高度 h 与绳端移动距离 s 的关系(n=2),以及力的方向',
    actionNames: ['showStructure', 'liftObject'],
    problemText: script.problem.text,
    answerText: script.problem.answer,
    timeoutMs: 180_000,
    onCall: (info) => console.log(`  [${info.label}] ${(info.ms / 1000).toFixed(1)}s`)
  })

  console.log('\n结果:', { kind: result.kind, path: result.path, attempts: result.attempts, bytes: result.html?.length ?? 0, issues: result.issues })
  if (result.kind !== 'html' || !result.html) {
    console.log('没拿到 html(降级成了 static),没法继续量填充比例。')
    return
  }

  console.log('\n静态扫描(含新加的画布尺寸检查):', checkHtmlStatic(result.html))

  // 量一下:内容(canvas/svg)占画布的比例,跟 xn9a 的旧样本对比
  const browser = await chromium.launch()
  const measure = async (html: string, label: string) => {
    const page = await browser.newPage({ viewport: { width: 500, height: 400 } })
    await page.setContent(
      `<body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="width:445px;height:278px;border:1px solid #ccc" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe></body>`
    )
    await page.waitForTimeout(1500)
    const outerBox = await page.locator('#f').boundingBox()
    const frame = page.frames().find((f) => f !== page.mainFrame())
    const el = frame ? await frame.locator('canvas, svg').first() : null
    let contentBox = null
    try {
      contentBox = el ? await el.boundingBox() : null
    } catch {
      contentBox = null
    }
    // 内容“实际画了多大一块”不好从截图外量,这里用画布可见框(fillW/fillH)当近似;
    // 真要量绘制内容边界得进 iframe 内部 evaluate,但沙箱隔离拿不到——所以主要看截图肉眼判断。
    await page.screenshot({ path: resolve(HERE, `../.scratch/verify-${label}.png`) })
    await page.close()
    return { outerBox, contentBox }
  }

  mkdirSync(resolve(HERE, '../.scratch'), { recursive: true })
  console.log('\n新生成的:', await measure(result.html, 'new'))
  console.log('旧样本(xn9a a_pulley):', await measure(oldAnim.html, 'old'))
  await browser.close()
  console.log('\n截图见 server/.scratch/verify-new.png / verify-old.png')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
