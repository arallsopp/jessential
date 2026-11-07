const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { ROOT, cachedFiles, currentVersion, expectedVersion } = require('../scripts/sw-version');

test.describe('version stamp', () => {
  test('sw.js VERSION matches the files it caches (run `npm run stamp`)', () => {
    expect(currentVersion()).toBe(expectedVersion());
  });

  test('every font the page uses is cached for offline use', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const fonts = [...html.matchAll(/url\((fonts\/[^)]+)\)/g)].map(m => m[1]);
    expect(fonts.length).toBeGreaterThan(0);
    expect(cachedFiles()).toEqual(expect.arrayContaining([...fonts, 'index.html', 'manifest.webmanifest', 'icon-180.png']));
  });
});

// A private copy of the site, so a test can publish a "new version" of it.
function serveCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jessential-'));
  for (const f of ['sw.js', ...cachedFiles()]) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    let name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.join(dir, name);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/`,
    publish(version, change = s => s) {
      const sw = path.join(dir, 'sw.js');
      fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
      const index = path.join(dir, 'index.html');
      fs.writeFileSync(index, change(fs.readFileSync(index, 'utf8')));
    },
    close() { server.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  })));
}

test.describe('installable app', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Playwright only drives service workers in Chromium');
  test.use({ serviceWorkers: 'allow' });
  let site;
  test.beforeEach(async ({ page }) => {
    site = await serveCopy();
    page.on('pageerror', e => { throw e; });
    page.on('dialog', d => d.accept());
    await page.goto(site.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  });
  test.afterEach(() => site.close());

  const checkForUpdate = page => page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  const openPam = async page => {
    await page.click('#who-jessica');
    await page.locator('#pamDoor').dispatchEvent('pointerdown');
    await expect(page.locator('#pamView')).toBeVisible({ timeout: 3000 });
  };

  test('has a manifest and icon for installing', async ({ page }) => {
    const m = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
    expect(m).toMatchObject({ display: 'standalone', start_url: 'index.html' });
    expect(await page.locator('link[rel=apple-touch-icon]').getAttribute('href')).toBe('icon-180.png');
  });

  test('opens and reads without a connection', async ({ page, context }) => {
    await context.setOffline(true);
    await page.reload();
    await page.click('#who-zachary');
    await page.getByRole('button', { name: 'Zachary and the Big Digger' }).click();
    await expect(page.locator('#paneA article')).toContainText('little red digger');
    const fontOk = await page.evaluate(async () => (await fetch('fonts/andika-400.woff2')).ok);
    expect(fontOk).toBe(true);
    await context.setOffline(false);
  });

  test('does not offer an update on first install', async ({ page }) => {
    await expect(page.locator('#updateBar')).toBeHidden();
    await openPam(page);
    await expect(page.locator('#appVersion')).toHaveText(`Version ${currentVersion()}`);
  });

  test('spots a new version, and updating keeps stories and looks', async ({ page }) => {
    await page.click('#who-zachary');
    await page.evaluate(() => { state.settings.size = 40; state.stories[0].page = 3; changed(); });
    await page.click('#notMe');

    site.publish('v2-test', s => s.replace('Who\'s reading?</h1>', 'Who\'s reading today?</h1>'));
    await checkForUpdate(page);
    await expect(page.locator('#updateBar')).toBeVisible();
    await expect(page.locator('#updateBar')).toContainText('Stories and looks are kept');

    await Promise.all([page.waitForEvent('load'), page.click('#updateNow')]);
    await expect(page.getByRole('heading', { name: "Who's reading today?" })).toBeVisible();
    await expect(page.locator('#updateBar')).toBeHidden();
    await page.click('#who-zachary');
    expect(await page.evaluate(() => ({ size: state.settings.size, page: state.stories[0].page }))).toEqual({ size: 40, page: 3 });
    await page.locator('#pamDoor').dispatchEvent('pointerdown');
    await expect(page.locator('#appVersion')).toHaveText('Version v2-test', { timeout: 3000 });
  });

  test('never interrupts a story or a game, and offers it afterwards', async ({ page }) => {
    await page.click('#who-jessica');
    await page.getByRole('button', { name: 'The Runaway Kite' }).click();
    site.publish('v3-test');
    await checkForUpdate(page);
    await page.waitForTimeout(1500);
    await expect(page.locator('#updateBar')).toBeHidden();
    await page.click('#readHome');
    await page.click('#playGame');
    await expect(page.locator('#updateBar')).toBeHidden();
    await page.click('#lookHome');
    await page.click('#notMe');
    await expect(page.locator('#updateBar')).toBeVisible();
    await openPam(page);
    await expect(page.locator('#updateBar')).toBeVisible();
  });

  test('an update waiting from last time is offered when the app opens', async ({ page }) => {
    site.publish('v4-test');
    await checkForUpdate(page);
    await expect(page.locator('#updateBar')).toBeVisible();
    await page.reload();
    await expect(page.locator('#updateBar')).toBeVisible();
  });
});
