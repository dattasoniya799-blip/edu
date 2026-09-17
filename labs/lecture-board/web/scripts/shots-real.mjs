/**
 * 对真服务端跑出来的课程截图 → web/shots/real-*.png
 *   浮力题:开讲前 / 播 45s / 跳到结尾
 *   圆题、正方形题:各一张中段(验证 template 动画与 html 动画都能上板)
 * 跑之前 server(:4310)与 web(:4311)都要起着。
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const DIR = decodeURIComponent(new URL('../shots/', import.meta.url).pathname);
mkdirSync(DIR, { recursive: true });

const LESSONS = {
  buoyancy: '20260917-104306-yeqe-03-浮力潜艇',
  circle: '20260917-103913-k50h-01-圆与圆周角',
  square: '20260917-104540-hidt-02-正方形旋转',
};

const browser = await chromium.launch();
const report = {};

async function openLesson(id, key) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
  const problems = [];
  report[key] = problems;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text().slice(0, 200)}`));
  await page.goto(`http://localhost:4311/lesson/${encodeURIComponent(id)}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__board?.ready === true, { timeout: 30000 });
  await page.evaluate(() => window.__board.setMuted(true)); // 无头环境没有 TTS,按字数估时推进
  await page.waitForTimeout(2000);
  return page;
}

/* --------------------------- 浮力题:三张 --------------------------- */
{
  const page = await openLesson(LESSONS.buoyancy, 'buoyancy');
  await page.screenshot({ path: `${DIR}real-01-浮力-开讲前.png` });
  console.log('✓ real-01-浮力-开讲前.png');

  await page.getByLabel('播放/暂停').click();
  await page.waitForTimeout(45000);
  await page.screenshot({ path: `${DIR}real-02-浮力-播45秒.png` });
  console.log('✓ real-02-浮力-播45秒.png');

  // 连点「下一步」直到按钮变灰(验证末步不重播、终态补齐)
  for (let i = 0; i < 25; i++) {
    const btn = page.getByLabel('下一步');
    if (await btn.isDisabled()) break;
    await btn.click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2500);
  const end = await page.evaluate(() => ({
    nextDisabled: document.querySelector('[aria-label="下一步"]').disabled,
    takeaways: document.querySelectorAll('.takeaway-item').length,
    tasks: document.querySelectorAll('.explore-task').length,
    repeatedSay: (() => {
      const c = {};
      for (const e of document.querySelectorAll('.nr-say')) c[e.textContent] = (c[e.textContent] || 0) + 1;
      return Math.max(0, ...Object.values(c));
    })(),
  }));
  await page.screenshot({ path: `${DIR}real-03-浮力-跳到结尾.png` });
  console.log(`✓ real-03-浮力-跳到结尾.png  ${JSON.stringify(end)}`);
  await page.close();
}

/* ------------------ 圆题 / 正方形题:各一张中段 ------------------ */
async function midShot(key, id, file, stepIndex, flowIndex, cardSel) {
  const page = await openLesson(id, key);
  await page.evaluate(([s, f]) => window.__board.seek(s, f), [stepIndex, flowIndex]);
  await page.waitForTimeout(3500);
  const mounted = await page.evaluate((sel) => {
    const host = document.querySelector(sel);
    if (!host) return 'no-card';
    if (host.querySelector('iframe')) return 'html-iframe';
    const svg = host.querySelector('.anim-host svg');
    return svg ? `template-svg(${svg.querySelectorAll('*').length} 个图元)` : 'empty';
  }, cardSel);
  await page.screenshot({ path: `${DIR}${file}` });
  console.log(`✓ ${file}  动画卡:${mounted}`);
  await page.close();
}

await midShot('circle', LESSONS.circle, 'real-04-圆-模板动画.png', 4, 12, '[data-card-root="k_anim"]');
await midShot('square', LESSONS.square, 'real-05-正方形-html动画.png', 3, 12, '[data-card-root="k2_anim"]');

console.log('\n--- 控制台 ---');
for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v.length ? v.join('\n  ') : '零报错'}`);
await browser.close();
