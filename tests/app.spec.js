const { test, expect } = require('@playwright/test');

// 500 distinct words in short sentences: splits into three or more parts.
const LONG_STORY = Array.from({ length: 100 }, (_, i) => `Sentence ${i} has five words.`).join(' ');

async function open(page, hash = '') {
  await page.goto('/index.html' + hash);
}
async function pasteStory(page, text) {
  await page.click('#tab-story');
  await page.fill('#story', text);
  await page.waitForFunction(t => state.story === t, text);
}
const parts = page => page.evaluate(() => passages());
const articleText = page => page.locator('#paneA article').innerText();

async function timedRead(page) {
  await page.click('#tab-test');
  await page.click('#startTrial');
  const text = await articleText(page);
  await page.click('#finishTrial');
  return text;
}
async function saveResult(page) {
  await page.click('#testResult button[type=submit]');
  await expect(page.locator('#testResult')).toBeHidden();
}
const intro = page => page.locator('#testIntro');

test.beforeEach(({ page }) => {
  page.on('pageerror', e => { throw e; });
});

test.describe('splitting a story into parts', () => {
  test('keeps punctuation at the start of a sentence', async ({ page }) => {
    await open(page);
    await pasteStory(page, '...and then it ended. ?! What now?');
    const [part] = await parts(page);
    expect(part.paras).toEqual(['...and then it ended. ?! What now?']);
  });

  test('keeps a trailing ellipsis that stands alone', async ({ page }) => {
    await open(page);
    await pasteStory(page, 'She waited. ...');
    expect((await parts(page))[0].paras).toEqual(['She waited. ...']);
  });

  test('shows the leading punctuation in a timed read', async ({ page }) => {
    await open(page);
    await pasteStory(page, '...and then it ended.');
    expect(await timedRead(page)).toContain('...and then it ended.');
  });

  test('does not break a part inside a decimal or a web address', async ({ page }) => {
    await open(page);
    const filler = Array.from({ length: 129 }, (_, i) => `w${i}`).join(' ');
    await pasteStory(page, `${filler} 3.5 apples at example.com today.`);
    const all = (await parts(page)).flatMap(p => p.paras).join(' ');
    expect(all).toContain('3.5 apples at example.com today.');
  });

  test('keeps every word, in order, with accurate counts', async ({ page }) => {
    await open(page);
    const story = `${LONG_STORY}\n\n"Stop!" he said. Is it 3.5? Yes... maybe\n\nNo end mark here`;
    await pasteStory(page, story);
    const ps = await parts(page);
    expect(ps.length).toBeGreaterThan(1);
    const words = t => t.trim().split(/\s+/);
    expect(words(ps.flatMap(p => p.paras).join(' '))).toEqual(words(story));
    for (const p of ps) expect(p.words).toBe(words(p.paras.join(' ')).length);
  });

  test('merges a very short last part into the one before', async ({ page }) => {
    await open(page);
    const body = Array.from({ length: 26 }, (_, i) => `Sentence ${i} has five words.`).join(' ');
    await pasteStory(page, `${body} Short ending.`);
    const ps = await parts(page);
    expect(ps).toHaveLength(1);
    expect(ps[0].words).toBe(132);
  });
});

test.describe('moving through the parts', () => {
  test('cancelling does not use up the part', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await page.click('#tab-test');
    await expect(intro(page)).toContainText('part 1 of');
    await page.click('#startTrial');
    await page.click('#cancelTrial');
    await expect(intro(page)).toContainText('part 1 of');
  });

  test('pressing Escape does not use up the part', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await page.click('#tab-test');
    await page.click('#startTrial');
    await page.keyboard.press('Escape');
    await expect(page.locator('#trialBar')).toBeHidden();
    await expect(intro(page)).toContainText('part 1 of');
  });

  test('closing the page during a read does not use up the part', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await page.click('#tab-test');
    await page.click('#startTrial');
    await page.reload();
    await page.click('#tab-test');
    await expect(intro(page)).toContainText('part 1 of');
  });

  test('a finished read moves on, even if its result is discarded', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await timedRead(page);
    await page.click('#discardResult');
    await expect(intro(page)).toContainText('part 2 of');
  });

  test('the same part is offered again after a cancel', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await page.click('#tab-test');
    await page.click('#startTrial');
    const first = await articleText(page);
    await page.click('#cancelTrial');
    await page.click('#startTrial');
    expect(await articleText(page)).toBe(first);
  });

  test('the full story comes back after a read ends', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await timedRead(page);
    expect(await articleText(page)).toContain('Sentence 99 has five words.');
  });
});

test.describe('recording which part was read', () => {
  test('stores the part with the result', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    const total = (await parts(page)).length;
    await timedRead(page);
    await saveResult(page);
    await timedRead(page);
    await saveResult(page);
    const trials = await page.evaluate(() => state.trials);
    expect(trials.map(t => t.part)).toEqual([1, 2]);
    expect(trials.every(t => t.parts === total)).toBe(true);
    expect(trials[0].storyId).toMatch(/^[0-9a-f]+$/);
    expect(trials[0].storyId).toBe(trials[1].storyId);
  });

  test('shows the parts for each setup', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await timedRead(page);
    await saveResult(page);
    await timedRead(page);
    await saveResult(page);
    await expect(page.locator('.result')).toContainText('Timed on parts 1, 2');
  });

  test('warns only when setups have no timed part in common', async ({ page }) => {
    await open(page);
    await pasteStory(page, 'One short part only.');
    const warning = page.locator('#speedWarning');

    await timedRead(page);
    await saveResult(page);
    await expect(warning).toHaveCount(0);

    // A different story: part 1 again, but not the same text.
    await page.click('#tab-look');
    await page.locator('#sl-size').fill('24');
    await pasteStory(page, 'A different short part.');
    await timedRead(page);
    await saveResult(page);
    await expect(warning).toBeVisible();

    // The second setup now also reads the first story, so they overlap.
    await pasteStory(page, 'One short part only.');
    await timedRead(page);
    await saveResult(page);
    await expect(warning).toHaveCount(0);
  });

  test('warns about older results with no part recorded', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      state.trials = [
        { settings: { ...DEFAULTS }, words: 100, ms: 60000, wpm: 100, rating: 3, note: '', at: '2026-01-01' },
        { settings: { ...DEFAULTS, size: 30 }, words: 100, ms: 30000, wpm: 200, rating: 4, note: '', at: '2026-01-02' },
      ];
      renderResults();
    });
    await page.click('#tab-test');
    await expect(page.locator('#speedWarning')).toBeVisible();
  });

  test('does not warn about untimed ratings', async ({ page }) => {
    await open(page);
    await page.click('#tab-test');
    await page.click('#justRate');
    await saveResult(page);
    await page.click('#tab-look');
    await page.locator('#sl-size').fill('24');
    await page.click('#tab-test');
    await page.click('#justRate');
    await saveResult(page);
    await expect(page.locator('.result')).toHaveCount(2);
    await expect(page.locator('#speedWarning')).toHaveCount(0);
  });

  test('exports the part in the CSV and guards against formulas', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await timedRead(page);
    await page.fill('#resultNote', '=SUM(A1)');
    await saveResult(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
    const fs = require('fs');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    const [head, row] = csv.replace(/^﻿/, '').split('\r\n');
    const cols = head.split(',').map(c => c.replace(/"/g, ''));
    const cells = row.match(/"(?:[^"]|"")*"/g).map(c => c.slice(1, -1));
    expect(cols).toEqual(expect.arrayContaining(['part', 'parts_in_story', 'story_id']));
    expect(cells).toHaveLength(cols.length);
    expect(cells[cols.indexOf('part')]).toBe('1');
    expect(cells[cols.indexOf('note')]).toBe("'=SUM(A1)");
  });
});

test.describe('saving', () => {
  test('keeps the story, look and results after a reload', async ({ page }) => {
    await open(page);
    await pasteStory(page, LONG_STORY);
    await page.click('#tab-look');
    await page.locator('#sl-size').fill('28');
    await timedRead(page);
    await saveResult(page);
    await page.reload();
    await expect(page.locator('#story')).toHaveValue(LONG_STORY);
    const saved = await page.evaluate(() => ({ size: state.settings.size, trials: state.trials.length }));
    expect(saved).toEqual({ size: 28, trials: 1 });
  });

  test('renders pasted markup as plain text', async ({ page }) => {
    await open(page);
    await pasteStory(page, '<img src=x onerror="window.hacked=1"> Hello.');
    await expect(page.locator('#paneA article img')).toHaveCount(0);
    expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  });
});

test.describe('shareable links', () => {
  async function linkFor(page) {
    await page.click('#tab-setups');
    await page.click('#copyLink');
    await expect(page.locator('#linkStatus')).not.toBeEmpty();
    return page.locator('#linkField').inputValue();
  }

  test('carries the look and aids to a new browser', async ({ page, browser }) => {
    await open(page);
    await page.evaluate(() => {
      state.settings = { ...DEFAULTS, font: 'lexend', fg: '#14233a', bg: '#dcecfb', size: 24, lh: 2, ruler: 'mask', bionic: true, align: 'justify' };
      changed();
    });
    const url = await linkFor(page);
    const expected = await page.evaluate(() => state.settings);

    const other = await browser.newContext();
    const fresh = await other.newPage();
    await fresh.goto(url);
    expect(await fresh.evaluate(() => state.settings)).toEqual(expected);
    await expect(fresh.locator('body')).toHaveClass(/panel-hidden/);
    expect(fresh.url()).not.toContain('#');
    await other.close();
  });

  test('leaves the story out unless asked', async ({ page }) => {
    await open(page);
    await pasteStory(page, 'A private story.');
    expect(await linkFor(page)).not.toContain('private');
    await page.check('#linkStory');
    expect(await linkFor(page)).toContain('private');
  });

  test('clamps or ignores bad values', async ({ page }) => {
    await open(page, '#v=1&size=9999&font=nope&fg=red&bg=00ff00&ruler=x&lh=abc');
    const s = await page.evaluate(() => state.settings);
    expect(s).toMatchObject({ size: 40, font: 'arial', fg: '#111111', bg: '#00ff00', ruler: 'off', lh: 1.6 });
  });

  test('asks before replacing a saved story', async ({ page }) => {
    await open(page);
    await pasteStory(page, 'My own story.');
    await page.goto('/index.html#text=' + encodeURIComponent('Their story.'));
    await expect(page.locator('#linkPrompt')).toBeVisible();
    await expect(page.locator('#story')).toHaveValue('My own story.');
    await page.click('#linkUseStory');
    await expect(page.locator('#story')).toHaveValue('Their story.');
  });
});
