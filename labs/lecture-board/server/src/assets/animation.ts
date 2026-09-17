/**
 * 动画素材:
 *  - kind=template:参数已在校验器里按 manifest 夹过,这里直接 ready(web 端用 LectureScene 运行时挂载);
 *  - kind=html:让 Qwen 现场生成一个自包含 HTML → 三道校验 → 不过重生成一次 → 再不过降级 static;
 *  - kind=static:模型自己给了 svg 就用,没给就用兜底 SVG。
 */
import type { Animation, BoardScript, FlowItem } from '../../../shared/schema'
import { unusedHtmlActions } from '../board-discipline'
import { redact } from '../config'
import type { ChatMessage, ChatPort } from '../ports'
import { checkHtmlRuntime, checkHtmlStatic, fallbackSvg, HTML_MAX_BYTES } from './animation-html'

/** 剧本里对某张 html 动画用到的全部 do.name */
export function usedActionNames(script: BoardScript, animationId: string): string[] {
  const names = new Set<string>()
  for (const step of script.steps ?? []) {
    for (const item of step.flow ?? []) {
      const f = item as Extract<FlowItem, { do: 'anim' }>
      if (f && f.do === 'anim' && f.target === animationId) {
        const name = (f.action as { name?: unknown })?.name
        if (typeof name === 'string' && name) names.add(name)
      }
    }
  }
  return [...names]
}

const HTML_SYSTEM_PROMPT = `你给中学讲题白板写一张「动画卡」:一个完全自包含的 HTML 片段,放进 sandbox="allow-scripts" 的 iframe 里播放。

只输出 HTML(可以放在 \`\`\`html 围栏里),不要任何解释。

硬要求(服务端会逐条静态扫描 + 无头浏览器跑一遍,任一不过就作废):
1. 一个文件搞定:内联 <style> 与 <script>,**不许** fetch(、XMLHttpRequest、import(、<script src=、<link href=,不许出现任何 http:// 或 https:// 地址(要内嵌图片只能用 data:)。总大小 ≤ ${HTML_MAX_BYTES / 1024} KB。
2. **画布必须真的占满容器,内容必须真的占满画布**(这是最容易画错的地方,历史上多次翻车:画面缩在左上角一小块):
   - html/body: \`margin:0;padding:0;width:100%;height:100%;overflow:hidden\`。
   - <canvas> 或 <svg> 本身: CSS \`width:100%;height:100%;display:block\`(不要用 height:auto,也不要留死板的 16:10 letterbox——容器多高就画多高)。
   - **canvas 的绘图分辨率(.width / .height 属性)必须按容器实际尺寸算,不能写死常量**:
     \`\`\`js
     function resize() {
       const dpr = Math.min(window.devicePixelRatio || 1, 2);
       const w = canvas.clientWidth, h = canvas.clientHeight;
       canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
       ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
       draw(w, h); // 用实际 w/h 重画,不要用生成时估的一个数
     }
     new ResizeObserver(resize).observe(canvas);
     resize();
     \`\`\`
   - **几何坐标按 w/h 的相对比例算,禁止写死一堆假设「画布很小」的绝对像素**(如 \`CX=300\` \`R=26\` 这种写死的数,不管画布多大都只占那一小块,画面就会缩在角落里)。画的东西要铺满 90% 以上的宽高——比如圆心用 \`w*0.5, h*0.45\`、半径用 \`Math.min(w,h)*0.22\` 这样按比例算,四周留白 ≤ 8%。svg 用 \`viewBox="0 0 100 62.5"\`(或任意比例)+ 上面那条 CSS,内部坐标也按这个虚拟视口的百分比摆。
   - 背景米白 #faf7f0,线条 #3a3a3a,强调色 #d1495b,辅助色 #2e86ab,字体 sans-serif。
3. 必须在 window 上暴露:
   window.lecture = {
     do(name, params) { … },      // 按动作名演示一段,幂等可重复调用
     unlock(params) { … },        // 动手环节:开放这些参数的滑杆/拖拽(没有就留空函数)
     reset() { … }                // 回到初始状态
   }
4. 加载完成后必须发一条:parent.postMessage({ type: 'lecture:ready' }, '*');出错时发 parent.postMessage({ type: 'lecture:error', message: String(e) }, '*')。
5. 必须监听父窗口消息并转发到上面三个方法:
   addEventListener('message', (e) => { const d = e.data || {};
     if (d.type === 'lecture:do') window.lecture.do(d.name, d.params);
     if (d.type === 'lecture:unlock') window.lecture.unlock(d.params);
     if (d.type === 'lecture:reset') window.lecture.reset(); });
6. do(name) 里对不认识的 name 要静默忽略,不许抛异常。动画用 requestAnimationFrame,单次 ≤ 2 秒;重复调用同一个 name 要能重放。
7. 图形要画准:题目给了长度/角度就按比例算坐标,不要凭感觉摆;关键点标上字母(A、B、E′ 这类单字母可以写在图上)。
8. 初始状态是「还没开始演示」的样子(画出静态图形即可),具体演示由 do(name) 触发。`

function buildHtmlUserMessage(o: { purpose: string; actionNames: string[]; problemText: string; answerText: string }): string {
  return [
    `题目(供你理解要演示什么):\n${o.problemText}`,
    o.answerText ? `答案(结论以此为准,图形要和它自洽):\n${o.answerText}` : '',
    `这张动画要演示:${o.purpose}`,
    o.actionNames.length
      ? `剧本会按顺序调用这些动作名,每个都要实现:${o.actionNames.map((n) => `do("${n}")`).join('、')}`
      : '剧本暂时只用 do("play") 一个动作。',
    '请输出这张动画卡的完整 HTML。'
  ]
    .filter(Boolean)
    .join('\n\n')
}

function extractHtml(raw: string): string {
  const text = String(raw ?? '').trim()
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.search(/<!doctype html|<html|<body|<div|<canvas|<svg|<style|<script/i)
  return start >= 0 ? body.slice(start) : body
}

export interface HtmlBuildResult {
  kind: 'html' | 'static'
  html?: string
  svg?: string
  /** 走了哪条路:一轮过 / 重生成后过 / 降级 */
  path: 'first-pass' | 'regenerated' | 'fallback-static'
  attempts: number
  issues: string[]
  ms: number
}

/**
 * 生成 + 三道校验 + 一次重生成 + static 降级。
 * 返回值一定可用:最差也是一张写着 purpose 的静态 SVG。
 */
export async function buildHtmlAnimation(
  port: ChatPort,
  o: {
    purpose: string
    actionNames: string[]
    problemText: string
    answerText: string
    timeoutMs?: number
    onCall?: (info: { label: string; ms: number; messages: ChatMessage[]; raw: string }) => void
  }
): Promise<HtmlBuildResult> {
  const started = Date.now()
  const actionNames = o.actionNames.length ? o.actionNames : ['play']
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: HTML_SYSTEM_PROMPT },
    { role: 'user', content: buildHtmlUserMessage({ ...o, actionNames }) }
  ]
  const allIssues: string[] = []
  let messages = baseMessages

  for (let attempt = 0; attempt < 2; attempt++) {
    let html = ''
    try {
      const callStarted = Date.now()
      const raw = await port.complete(messages, { temperature: 0.3, timeoutMs: o.timeoutMs ?? 180_000, maxTokens: 12_000, thinking: false })
      o.onCall?.({ label: `animation-html-${attempt + 1}`, ms: Date.now() - callStarted, messages, raw })
      html = extractHtml(raw)
    } catch (error) {
      allIssues.push(`第 ${attempt + 1} 次生成失败:${redact(error, 160)}`)
      continue
    }

    const issues = checkHtmlStatic(html)
    if (!issues.length) {
      const runtime = await checkHtmlRuntime(html, actionNames)
      issues.push(...runtime.issues)
    }
    if (!issues.length) {
      // 实现了却没人调的动作 = 白写的动画能力(硬约束 4);只提醒,不重生成
      const unused = unusedHtmlActions(html, actionNames)
      if (unused.length) allIssues.push(`HTML 里实现了 ${unused.join('、')} 但剧本一次都没调用`)
      return {
        kind: 'html',
        html,
        path: attempt === 0 ? 'first-pass' : 'regenerated',
        attempts: attempt + 1,
        issues: allIssues,
        ms: Date.now() - started
      }
    }
    allIssues.push(...issues.map((i) => `第 ${attempt + 1} 次:${i}`))
    messages = [
      ...baseMessages,
      { role: 'assistant', content: html.slice(0, 20_000) },
      {
        role: 'user',
        content: `你上一版动画没通过校验:\n${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n请修掉这些问题,重新输出完整 HTML(只输出 HTML)。`
      }
    ]
  }

  return {
    kind: 'static',
    svg: fallbackSvg(o.purpose),
    path: 'fallback-static',
    attempts: 2,
    issues: allIssues,
    ms: Date.now() - started
  }
}

/** 已经就绪的动画(template / 带 svg 的 static)不必再做什么 */
export function isAnimationReady(anim: Animation): boolean {
  return anim.kind === 'template' || (anim.kind === 'static' && Boolean(anim.svg))
}
