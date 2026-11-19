const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto('file://' + require('path').join(__dirname, '../../index.html')); await p.waitForTimeout(1500);
  await p.click('#btnScan'); await p.waitForTimeout(6000);
  await p.screenshot({ path: 'gui.png' });
  await b.close();
})();
