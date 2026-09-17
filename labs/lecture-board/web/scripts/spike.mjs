/**
 * 底座切换的三个风险点验证(一次跑完,结论打在 stdout):
 *  (a) viewModeEnabled 下 embeddable 能不能渲染 / 悬停提示 / 点击激活后可交互
 *  (b) 量高 → updateScene → 同列下方卡重排,不重叠不闪
 *  (c) 150ms 淡入
 */
import { chromium } from 'playwright';

const URL = process.env.BOARD_URL ?? 'http://localhost:4311/sample';
const out = [];
const log = (...a) => {
  console.log(...a);
  out.push(a.join(' '));
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__board?.ready === true, { timeout: 15000 });
await page.waitForTimeout(1200);

/* ---------------- (a) embeddable 渲染与交互 ---------------- */

const containers = await page.locator('.excalidraw__embeddable-container').count();
const cardRoots = await page.locator('[data-card-root]').count();
log(`[a1] embeddable 容器 ${containers} 个,卡片根 ${cardRoots} 个`);
const problemText = await page.locator('[data-card-root="k_problem"]').innerText().catch(() => '');
log(`[a2] 审题卡文字长度 ${problemText.length}(前 30:${problemText.slice(0, 30).replace(/\n/g, ' ')})`);

// 推进到第(2)问,让模板动画卡上板
await page.evaluate(() => window.__board.seek(1, 20));
await page.waitForTimeout(2000);
const animSvg = await page.locator('[data-card-root="k2_anim"] svg').count();
log(`[a3] 模板动画挂载(LectureScene svg)= ${animSvg > 0}`);

const animBox = await page.locator('[data-card-root="k2_anim"]').boundingBox();
const peBefore = await page.evaluate(() => {
  const el = document.querySelector('[data-card-root="k2_anim"]')?.closest('.excalidraw__embeddable-container__inner');
  return el ? getComputedStyle(el).pointerEvents : 'no-container';
});
log(`[a4] 激活前 pointer-events = ${peBefore}`);

if (animBox) {
  const cx = animBox.x + animBox.width / 2;
  const cy = animBox.y + animBox.height / 2;
  await page.mouse.move(cx - 40, cy - 40);
  await page.mouse.move(cx, cy, { steps: 6 });
  await page.waitForTimeout(500);
  const hint = await page.locator('.excalidraw__embeddable-hint').count();
  log(`[a5] 悬停提示出现 = ${hint > 0}`);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(500);
  const peAfter = await page.evaluate(() => {
    const el = document.querySelector('[data-card-root="k2_anim"]')?.closest('.excalidraw__embeddable-container__inner');
    return el ? getComputedStyle(el).pointerEvents : 'no-container';
  });
  log(`[a6] 单击激活后 pointer-events = ${peAfter}`);
}

/* ---------------- (b) 量高与重排 ---------------- */

const boxes = await page.evaluate(() => {
  const roots = [...document.querySelectorAll('[data-card-root]')];
  return roots.map((r) => {
    const outer = r.closest('.excalidraw__embeddable-container');
    const rect = outer?.getBoundingClientRect();
    return {
      id: r.dataset.cardRoot,
      domH: r.offsetHeight,
      boxH: rect ? Math.round(rect.height) : null,
      top: rect ? Math.round(rect.top) : null,
      left: rect ? Math.round(rect.left) : null,
    };
  });
});
log(`[b1] 卡高对照(DOM 高 vs 场景元素框高,同栏内):`);
for (const b of boxes) log(`      ${b.id}: dom=${b.domH} box=${b.boxH} top=${b.top} left=${b.left}`);

// 同列相邻卡有没有重叠
const byCol = {};
for (const b of boxes) {
  if (b.left == null) continue;
  (byCol[b.left] ??= []).push(b);
}
let overlap = 0;
for (const col of Object.values(byCol)) {
  col.sort((x, y) => x.top - y.top);
  for (let i = 1; i < col.length; i++) if (col[i].top < col[i - 1].top + col[i - 1].boxH - 2) overlap++;
}
log(`[b2] 同列重叠对数 = ${overlap}`);

const shotA = await page.screenshot();
await page.waitForTimeout(900);
const shotB = await page.screenshot();
log(`[b3] 静置 0.9s 前后截图字节差 = ${Math.abs(shotA.length - shotB.length)}(≈0 表示稳定不抖)`);

/* ---------------- (c) 淡入 ---------------- */

const fade = await page.evaluate(() => {
  const el = document.querySelector('[data-card-root]');
  if (!el) return 'no-card';
  const cs = getComputedStyle(el);
  return `${cs.animationName} ${cs.animationDuration}`;
});
log(`[c1] 卡片淡入动画 = ${fade}`);

/* ------------- (a 续) 动手环节:解锁后真拖一把滑杆 ------------- */

await page.evaluate(() => window.__board.summary());
await page.waitForTimeout(1200);
await page.evaluate(() => window.__board.focus('k2_anim')); // 把动画卡滚回视口
await page.waitForTimeout(900);

const readout = page.locator('[data-card-root="k2_anim"] .ls-slider[data-param="mw"] text').last();
const before = await readout.textContent().catch(() => '?');
const knob = page.locator('[data-card-root="k2_anim"] .ls-slider[data-param="mw"] .ls-handle').first();
const kb = await knob.boundingBox().catch(() => null);
if (kb) {
  const kx = kb.x + kb.width / 2;
  const ky = kb.y + kb.height / 2;
  await page.mouse.click(kx, ky); // 先点一下激活这张卡
  await page.waitForTimeout(300);
  await page.mouse.move(kx, ky);
  await page.mouse.down();
  await page.mouse.move(kx - 45, ky, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await readout.textContent().catch(() => '?');
  log(`[a7] 动手环节拖「注水」滑杆:${before} → ${after}(拖得动 = ${before !== after})`);
} else {
  log('[a7] 动手环节:没找到解锁的滑杆手柄');
}

log(`[err] pageerror/console.error 共 ${errors.length} 条`);
for (const e of errors.slice(0, 8)) log(`      ${e}`);

await browser.close();
