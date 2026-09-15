// Screenshot d'un diagramme HTML → PNG @2x (pipeline diagramme du skill pdf)
const path = require('path');
const fs = require('fs');

async function main() {
  let pw;
  try { pw = require('playwright'); }
  catch { pw = require('playwright-core'); }
  const [,, htmlPath, outPath] = process.argv;
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const body = await page.locator('body');
  await body.screenshot({ path: outPath });
  await browser.close();
  const size = fs.statSync(outPath).size;
  console.log('PNG écrit:', outPath, size, 'octets');
}
main().catch(e => { console.error(e); process.exit(1); });
