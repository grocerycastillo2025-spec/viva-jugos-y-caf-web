import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
for (const [nombre, url] of [['yoga', ''], ['css', '?yoga=0']]) {
  const p = await b.newPage({ viewport: { width: 900, height: 1600 }, deviceScaleFactor: 2 });
  await p.goto('file://' + process.cwd() + '/index.html' + url);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `menu-${nombre}.png`, fullPage: true });
  const m = await p.evaluate(() => [...document.querySelectorAll('div')]
    .filter((el) => /^(Acai Bowl|\$12\.95|Acai, blueberries)/.test((el.textContent||'').trim()) && el.children.length <= 1)
    .slice(0, 3)
    .map((el) => { const r = el.getBoundingClientRect();
      return `x=${Math.round(r.x)} w=${Math.round(r.width)} :: ${(el.textContent||'').slice(0,26)}`; }));
  console.log(`=== ${nombre} ===\n` + m.join('\n'));
  await p.close();
}
await b.close();
