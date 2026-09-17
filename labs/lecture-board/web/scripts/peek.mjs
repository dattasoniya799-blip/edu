/** 快照一眼:node scripts/peek.mjs [seekStep] [seekFlow] [outfile] */
import { chromium } from 'playwright';

const [, , step, flow, outfile = '/tmp/peek.png'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text().slice(0, 200)));
await page.goto('http://localhost:4311/sample', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__board?.ready === true, { timeout: 15000 });
await page.evaluate(() => window.__board.setMuted(true));
if (step != null) {
  await page.evaluate(([s, f]) => window.__board.seek(Number(s), Number(f)), [step, flow]);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: outfile });
console.log('saved', outfile);
await browser.close();
