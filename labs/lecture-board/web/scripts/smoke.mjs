/** 真按 ▷ 连播一段的冒烟检查:控制台零报错、卡片在浮现、旁白流在长。 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text().slice(0, 200)}`));

await page.goto('http://localhost:4311/sample', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__board?.ready === true, { timeout: 20000 });
await page.evaluate(() => window.__board.setMuted(true)); // 静音:按字数估时,不等 TTS

const count = () => page.locator('[data-card-root]').count();
const says = () => page.locator('.nr-say').count();
const before = await count();

await page.getByLabel('播放/暂停').click();
await page.waitForTimeout(13000);
const mid = await count();
const midSays = await says();

// 暂停:板书与旁白都应该冻住
await page.getByLabel('播放/暂停').click();
await page.waitForTimeout(2500);
const afterPause = await count();

// 下一步:跳步补齐
await page.getByLabel('下一步').click();
await page.waitForTimeout(2500);
const afterNext = await count();

console.log(`卡片数:开讲前 ${before} → 播 13s ${mid} → 暂停 2.5s ${afterPause} → 下一步 ${afterNext}`);
console.log(`旁白段数:${midSays}`);
console.log(`暂停期间没有新卡浮现 = ${mid === afterPause}`);
console.log(`播了之后卡变多 = ${mid > before};旁白流在长 = ${midSays > 0}`);
console.log(problems.length ? `⚠️ 控制台问题:\n${problems.join('\n')}` : '✓ 控制台零报错');
await browser.close();
