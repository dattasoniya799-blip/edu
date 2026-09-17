/**
 * 动画桥三条路各走一遍(protocol.md「动画桥」):
 *   template → 同源挂 LectureScene,applyAction 生效
 *   html     → sandbox iframe 收到 lecture:ready,parent 发的 lecture:do 被执行
 *   static   → 直接渲染降级 SVG,动作不报错
 * 跑之前先 npm run dev。
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const problems = [];

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on('pageerror', (e) => problems.push(`[${query}] pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`[${query}] console.error: ${m.text().slice(0, 160)}`));
  await page.goto(`http://localhost:4311/sample${query}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__board?.ready === true, { timeout: 20000 });
  await page.evaluate(() => window.__board.setMuted(true));
  // steps[2] = 第(2)问(浮力,挂 k2_anim);sample-buoyancy.json 现在以 s0(审题)开头,
  // 步号比这脚本原来写的时候整体 +1 了(2026-09-17 审题 step 上线时挪的,这里跟着改)。
  await page.evaluate(() => window.__board.seek(2, 20));
  await page.waitForTimeout(2500);
  return page;
}

/* --------------------------- template --------------------------- */
{
  const page = await open('');
  const svg = await page.locator('[data-card-root="k2_anim"] .anim-host svg').count();
  const shownLayers = await page.evaluate(() => {
    const s = document.querySelector('[data-card-root="k2_anim"] .anim-host svg');
    return s ? [...s.children].filter((g) => g.getAttribute('opacity') === '1').length : 0;
  });
  console.log(`template:挂载 svg=${svg > 0},show 动作点亮的层数=${shownLayers}(剧本里发了 4 个 show)`);
  await page.close();
}

/* ----------------------------- html ----------------------------- */
{
  const page = await open('?anim=html');
  const frame = page.frameLocator('[data-card-root="k2_anim"] iframe');
  const log = await frame.locator('#log').textContent();
  const ready = (await page.locator('[data-card-root="k2_anim"] .anim-purpose').first().textContent()) ?? '';
  const tankShown = await frame.locator('#tank').getAttribute('opacity');
  console.log(`html:iframe 内 log="${log}",tank opacity=${tankShown},还在等 ready = ${ready.includes('加载中')}`);
  await page.close();
}

/* ---------------------------- static ---------------------------- */
{
  const page = await open('?anim=static');
  const svg = await page.locator('[data-card-root="k2_anim"] .anim-host svg').count();
  const text = (await page.locator('[data-card-root="k2_anim"] .anim-host').textContent()) ?? '';
  console.log(`static:渲染 svg=${svg > 0},内容="${text.trim()}"`);
  await page.close();
}

console.log(problems.length ? `⚠️ 控制台问题:\n${problems.join('\n')}` : '✓ 三条路控制台零报错');
await browser.close();
