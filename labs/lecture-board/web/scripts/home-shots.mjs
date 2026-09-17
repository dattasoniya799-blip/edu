/**
 * 首页改版验收:
 *   1) 1600×950 截图 → web/shots/home.png
 *   2) 真点一次「试讲这道」(浮力潜艇),确认跳到 /lesson/:id 并进入「正在备课」
 *      (会真的调模型花几分钱,只点这一次)。
 * 跑之前先 `npm run dev`(:4311 + :4310 都要起着)。
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const DIR = decodeURIComponent(new URL('../shots/', import.meta.url).pathname);
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });

const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text().slice(0, 300)}`));

await page.goto('http://localhost:4311/', { waitUntil: 'networkidle' });
// 等示例题网格与课程库都渲染出真实卡片(不是骨架屏),截图更能反映成品状态
await page.waitForSelector('.sample-card:not(.is-skeleton)', { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}home.png` });
console.log('✓ home.png');

// 找「浮力潜艇」那张示例题卡片,点「试讲这道」
const card = page.locator('.sample-card', { hasText: '浮力潜艇' });
await card.waitFor({ timeout: 10000 });
await card.getByRole('button', { name: '试讲这道' }).click();

await page.waitForURL(/\/lesson\//, { timeout: 15000 });
const url = page.url();
console.log(`✓ 跳转到 ${url}`);

// LessonPage 在剧本到达前渲染 PlanningProgress,标题是「正在备课…」
await page.waitForSelector('h1', { timeout: 15000 });
const h1 = await page.locator('h1').first().innerText();
console.log(`✓ 讲题页 h1 = "${h1}"`);
if (!h1.includes('备课')) {
  console.error(`✗ 期望「正在备课…」,实际是「${h1}」`);
  process.exitCode = 1;
}

await page.waitForTimeout(1500);
await page.screenshot({ path: `${DIR}home-sample-jump.png` });
console.log('✓ home-sample-jump.png(备课中截图,供人工核对)');

console.log(problems.length ? `⚠️ 控制台问题 ${problems.length} 条:\n${problems.join('\n')}` : '✓ 首页 + 跳转全程控制台零报错');
await browser.close();
