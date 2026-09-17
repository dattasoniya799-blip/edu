/**
 * 运行问题复查(2026-09-17)· 播放器:移动端 / 窗口 resize 不崩。
 * 打开一节已经真跑完的课(GET 只读,不打真接口),连续变窗口尺寸(桌面 → 窄屏 → 移动端 → 回桌面),
 * 边播边缩放,确认零 console 报错、零 pageerror,且关键 DOM 还在。
 * 跑之前 server(:4310)与 web(:4311)都要起着(本仓库已经在跑,不要再起第二个)。
 */
import { chromium } from 'playwright';

const LESSON_ID = process.argv[2] ?? '20260917-133054-jlof'; // 潜艇模型:压强浮力功(真实已完成的课)

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text().slice(0, 200)}`));

await page.goto(`http://localhost:4311/lesson/${encodeURIComponent(LESSON_ID)}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__board?.ready === true, { timeout: 30000 });
await page.evaluate(() => window.__board.setMuted(true));
console.log('✓ 加载完成,开始播放并连续 resize');

await page.getByLabel('播放/暂停').click();

const sizes = [
  [1600, 950, '桌面宽屏'],
  [1024, 768, '平板横屏'],
  [768, 1024, '平板竖屏'],
  [390, 844, '手机竖屏(iPhone 12 尺寸)'],
  [844, 390, '手机横屏'],
  [1600, 950, '回到桌面宽屏']
];

for (const [w, h, label] of sizes) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1200);
  const alive = await page.evaluate(() => Boolean(document.querySelector('.stage canvas, .stage svg')));
  console.log(`  ${label}(${w}x${h}):画布还在=${alive}`);
  if (!alive) problems.push(`resize 到 ${label} 后画布消失`);
}

await page.waitForTimeout(1500);

console.log(problems.length ? `\n✗ 发现 ${problems.length} 个问题:\n${problems.join('\n')}` : '\n✓ 全程零报错,画布始终存活');
await browser.close();
process.exit(problems.length ? 1 : 0);
