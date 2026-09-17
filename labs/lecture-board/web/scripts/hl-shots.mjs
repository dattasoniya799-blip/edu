/**
 * 「讲到哪、亮到哪」验收截图(protocol.md 播放器时序 §2)→ web/shots/hl-*.png
 *   hl-01-审题-沉入水底.png   s0(审题)第 10 项(讲到「沉入水底」那句):题干该片段黄底 + 红圈已画上,
 *                            analysis 卡已现的块(given)与未现的块(hidden/find/ideas)并存
 *   hl-02-第1问-l1b黄底.png   s1(第(1)问)第 5 项(讲到 l1b 那句):该行(以及跨列的 mark)黄底
 *   hl-03-第1问-结论红圈.png  s1 整步放完(结论句念完):红圈保留在 l1d 上,黄底已退
 *
 * seek(stepIndex, flowIndex) 是 window.__board 的调试钩子(瞬时推进,不播音);
 * flowIndex 越界(≥ 该步 flow 长度)代表「这一步已经放完」,不是「停在某一项」。
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
await page.waitForTimeout(800);

// 1) 审题:讲到「沉入水底」那句(s0 第 10 项,isCurrent → speaking 生效 + emph:'circle' 提前画圈)
await page.evaluate(() => window.__board.seek(0, 10));
await page.evaluate(() => window.__board.focus('c0'));
await page.waitForTimeout(700);
await page.screenshot({ path: `${DIR}hl-01-审题-沉入水底.png` });
console.log('✓ hl-01-审题-沉入水底.png');

// 2) 第(1)问:讲到 l1b 那句(s1 第 5 项)
await page.evaluate(() => window.__board.seek(1, 5));
await page.waitForTimeout(700);
await page.screenshot({ path: `${DIR}hl-02-第1问-l1b黄底.png` });
console.log('✓ hl-02-第1问-l1b黄底.png');

// 3) 第(1)问结论句念完:flowIndex 越界 = 整步已放完,l1d 的 emph:'circle' 已经落定,没有临时黄底
await page.evaluate(() => window.__board.seek(1, 99));
await page.waitForTimeout(700);
await page.screenshot({ path: `${DIR}hl-03-第1问-结论红圈.png` });
console.log('✓ hl-03-第1问-结论红圈.png');

console.log(problems.length ? `⚠️ 控制台问题 ${problems.length} 条:\n${problems.join('\n')}` : '✓ 控制台零报错');
await browser.close();
