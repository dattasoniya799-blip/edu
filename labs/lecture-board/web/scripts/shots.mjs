/**
 * /sample 的三张验收截图 → web/shots/
 *   01-开讲前.png       审题列整列可见(题干三色高亮 + 题图 + 审题四块)
 *   02-第2问讲到一半.png  动画卡 + 板书 + 红圈
 *   03-总结.png         总结四色块 + 动手任务
 * 跑之前先 `npm run dev`(:4311)。
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BOARD_URL = process.env.BOARD_URL ?? 'http://localhost:4311/sample';
const DIR = decodeURIComponent(new URL('../shots/', import.meta.url).pathname);
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });

const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text().slice(0, 200)}`));

await page.goto(BOARD_URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__board?.ready === true, { timeout: 20000 });
await page.evaluate(() => window.__board.setMuted(true));
await page.waitForTimeout(1500);

await page.screenshot({ path: `${DIR}01-开讲前.png` });
console.log('✓ 01-开讲前.png');

// 第(2)问:动画卡已挂、板书写到结论、红圈圈住 F浮 = 6 N;顺手让配图落地(演占位替换)
await page.evaluate(() => window.__board.deliverFigure());
await page.evaluate(() => window.__board.seek(1, 20));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${DIR}02-第2问讲到一半.png` });
console.log('✓ 02-第2问讲到一半.png');

await page.evaluate(() => window.__board.summary());
await page.waitForTimeout(2500);
await page.screenshot({ path: `${DIR}03-总结.png` });
console.log('✓ 03-总结.png');

console.log(problems.length ? `⚠️ 控制台问题 ${problems.length} 条:\n${problems.join('\n')}` : '✓ 控制台零报错');
await browser.close();
