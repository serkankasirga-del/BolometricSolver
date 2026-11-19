const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + __dirname + '/doc.html'); await p.waitForTimeout(800);
  await p.pdf({ path: process.argv[2], format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="font-size:8px; width:100%; padding:0 18mm; color:#6b7280; font-family:Helvetica,Arial; display:flex; justify-content:space-between"><span>Bolometric Thermometry Solver — Theory and Implementation</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' } });
  await b.close();
})();
