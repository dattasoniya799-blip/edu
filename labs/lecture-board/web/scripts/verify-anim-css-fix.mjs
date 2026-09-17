/**
 * README「运行问题复查(2026-09-17)」验证脚本:LLM 生成的 HTML 动画画面偏小。
 *
 * 不打真接口、不用起 server/web —— 直接从 server/data/lessons/<id>/state.json 里挑几个已经真跑出来的
 * html 动画样本(正方形旋转 / 滑轮组 / 电路 / 一次函数),按卡片实际尺寸(COL_W=445,16:10 → 278 高)
 * 渲染两遍:
 *   - before:动画原始 HTML,iframe 固定 style.height=280(旧写法)
 *   - after :lib/html-anim.ts 的 withBaseCss() 包过的 HTML,iframe 高度=animIframeHeight(445)
 * 每个样本量一下画面内容(canvas/svg)的渲染框相对 iframe 的填充比例,并截图存 shots/anim-fix-*.png
 * 供人工核对「至少不比之前差」。
 *
 * 跑法:node scripts/verify-anim-css-fix.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const LESSONS_ROOT = resolve(HERE, '../../server/data/lessons');
const SHOTS_DIR = resolve(HERE, '../shots');
mkdirSync(SHOTS_DIR, { recursive: true });

const CARD_W = 445; // web/src/board/layout.ts COL_W
const OLD_H = 280; // AnimationCard.tsx 改之前写死的高度
const NEW_H = Math.round(Math.min(560, Math.max(160, CARD_W * (10 / 16)))); // lib/html-anim.ts animIframeHeight

const BASE_CSS =
  '<style id="__lecture_base_css">' +
  'html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important}' +
  'canvas,svg{display:block!important;width:100%!important;height:100%!important}' +
  '</style>';

function withBaseCss(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${BASE_CSS}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}${BASE_CSS}`);
  return `${BASE_CSS}${html}`;
}

function pickSamples() {
  // 一个关键词只取一份样本,保证覆盖不同题型(正方形旋转 / 滑轮组 / 电路 / 一次函数),不被同类题挤掉
  const wanted = ['104540-hidt-02-正方形旋转', 'xn9a', 'zoks', '5gba'];
  const dirs = readdirSync(LESSONS_ROOT);
  const out = [];
  for (const key of wanted) {
    const dir = dirs.find((d) => d.includes(key));
    if (!dir) continue;
    const p = resolve(LESSONS_ROOT, dir, 'state.json');
    if (!existsSync(p)) continue;
    let state;
    try {
      state = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    const anims = state.script?.animations ?? [];
    const anim = anims.find((a) => a.kind === 'html' && a.html);
    if (anim) out.push({ dir, id: `${key}-${anim.id}`, html: anim.html, purpose: anim.purpose });
  }
  return out;
}

function hostPage(html, iframeH) {
  return `<!doctype html><html><body style="margin:0;background:#e5e5e5">
    <div id="card" style="width:${CARD_W}px;background:#fff;padding:8px;box-sizing:border-box">
      <iframe id="f" sandbox="allow-scripts" referrerpolicy="no-referrer" style="display:block;width:100%;height:${iframeH}px;border:0" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>
    </div>
  </body></html>`;
}

async function measureFillRatio(page) {
  // srcdoc + sandbox="allow-scripts"(没给 allow-same-origin)时子文档是不透明源,
  // 父页面 JS 摸不到 contentDocument;但 Playwright 走 CDP,frame() 拿到的 frame 对象
  // 不受这层同源限制,可以量里面元素的真实渲染框。
  const outerBox = await page.locator('#f').boundingBox();
  const frame = page.frames().find((f) => f.url().startsWith('about:srcdoc') || f !== page.mainFrame());
  if (!frame) return null;
  const box = await frame.locator('canvas, svg').first().boundingBox().catch(() => null);
  if (!box || !outerBox) return null;
  return {
    fillW: +(box.width / outerBox.width).toFixed(3),
    fillH: +(box.height / outerBox.height).toFixed(3)
  };
}

const browser = await chromium.launch();
const results = [];

for (const sample of pickSamples()) {
  const errorsBefore = [];
  const errorsAfter = [];

  const pageBefore = await browser.newPage({ viewport: { width: CARD_W + 40, height: OLD_H + 60 } });
  pageBefore.on('pageerror', (e) => errorsBefore.push(String(e.message).slice(0, 120)));
  pageBefore.on('console', (m) => m.type() === 'error' && errorsBefore.push(m.text().slice(0, 120)));
  await pageBefore.setContent(hostPage(sample.html, OLD_H));
  await pageBefore.waitForTimeout(1200);
  const fillBefore = await measureFillRatio(pageBefore);
  await pageBefore.screenshot({ path: resolve(SHOTS_DIR, `anim-fix-${sample.id}-before.png`) });
  await pageBefore.close();

  const pageAfter = await browser.newPage({ viewport: { width: CARD_W + 40, height: NEW_H + 60 } });
  pageAfter.on('pageerror', (e) => errorsAfter.push(String(e.message).slice(0, 120)));
  pageAfter.on('console', (m) => m.type() === 'error' && errorsAfter.push(m.text().slice(0, 120)));
  await pageAfter.setContent(hostPage(withBaseCss(sample.html), NEW_H));
  await pageAfter.waitForTimeout(1200);
  const fillAfter = await measureFillRatio(pageAfter);
  await pageAfter.screenshot({ path: resolve(SHOTS_DIR, `anim-fix-${sample.id}-after.png`) });
  await pageAfter.close();

  results.push({
    lesson: sample.dir,
    animId: sample.id,
    purpose: sample.purpose.slice(0, 40),
    before: { iframeH: OLD_H, fill: fillBefore, errors: errorsBefore },
    after: { iframeH: NEW_H, fill: fillAfter, errors: errorsAfter }
  });
}

await browser.close();

for (const r of results) {
  console.log(`\n[${r.animId}] ${r.lesson}`);
  console.log(`  purpose: ${r.purpose}`);
  console.log(`  before: iframeH=${r.before.iframeH} fill=${JSON.stringify(r.before.fill)} errors=${r.before.errors.length}`);
  console.log(`  after : iframeH=${r.after.iframeH}  fill=${JSON.stringify(r.after.fill)} errors=${r.after.errors.length}`);
}

writeFileSync(resolve(SHOTS_DIR, 'anim-fix-report.json'), JSON.stringify(results, null, 2));
console.log(`\n截图与报告在 ${SHOTS_DIR}`);
