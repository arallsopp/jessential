const { test, expect } = require('@playwright/test');
const fs = require('fs');

// Headless browsers have no voices, so record what would have been spoken.
function stubSpeech() {
  const spoken = [];
  let speaking = false;
  window.__spoken = spoken;
  window.__holdSpeech = false;
  const stub = {
    get speaking() { return speaking; },
    pending: false,
    getVoices: () => [],
    addEventListener() {},
    cancel() { speaking = false; stub.current = null; },
    speak(u) {
      spoken.push({ text: u.text, lang: u.lang, rate: u.rate });
      speaking = true;
      stub.current = u;
      if (!window.__holdSpeech) setTimeout(() => {
        if (stub.current === u) { speaking = false; stub.current = null; u.onend && u.onend(); }
      }, 5);
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
}
const spoken = page => page.evaluate(() => window.__spoken.map(u => u.text));
const lastSpoken = page => page.evaluate(() => window.__spoken.at(-1));

test.beforeEach(async ({ page }) => {
  page.on('pageerror', e => { throw e; });
  page.on('dialog', d => d.accept());
  await page.addInitScript(stubSpeech);
  await page.goto('/index.html');
});

async function holdPamDoor(page) {
  await page.locator('#pamDoor').dispatchEvent('pointerdown');
  await expect(page.locator('#pamView')).toBeVisible({ timeout: 3000 });
}
async function addStory(page, title, text) {
  await page.fill('#newTitle', title);
  await page.fill('#newText', text);
  await page.click('#saveStory');
}
const openKite = page => page.getByRole('button', { name: 'The Runaway Kite' }).click();
const articleText = page => page.locator('#paneA article').innerText();
const backHome = page => page.click('#pamBack');

test.describe("Jessica's home", () => {
  test('opens on her stories, with no settings or tabs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Hello, Jessica!' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'The Runaway Kite' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Which is easier/ })).toBeVisible();
    await expect(page.locator('#tabs')).toBeHidden();
    await expect(page.locator('#topBar')).toBeHidden();
  });

  test("a quick tap does not open Pam's page", async ({ page }) => {
    const door = page.locator('#pamDoor');
    await door.dispatchEvent('pointerdown');
    await door.dispatchEvent('pointerup');
    await page.waitForTimeout(1400);
    await expect(page.locator('#pamView')).toBeHidden();
  });

  test("pressing and holding opens Pam's page", async ({ page }) => {
    await holdPamDoor(page);
    await backHome(page);
    await expect(page.locator('#homeView')).toBeVisible();
  });

  test('never shows reading speed', async ({ page }) => {
    await page.evaluate(() => {
      state.checks = [{ id: 'cat', words: 98, ms: 90000, wpm: 65, at: '2026-01-01T10:00:00Z', settings: {} }];
      show('home');
    });
    await expect(page.locator('#homeView')).not.toContainText(/words a minute|65/);
  });
});

test.describe('reading a story', () => {
  test('splits into pages and keeps every word', async ({ page }) => {
    const pages = await page.evaluate(() => pagesOf(state.stories[0]));
    const sample = await page.evaluate(() => SAMPLE);
    expect(pages.length).toBeGreaterThan(5);
    const words = t => t.trim().split(/\s+/);
    expect(words(pages.flatMap(p => p.paras).join(' '))).toEqual(words(sample));
  });

  test('moves between pages', async ({ page }) => {
    await openKite(page);
    await expect(page.locator('#pageNum')).toHaveText(/^Page 1 of \d+$/);
    await expect(page.locator('#prevPage')).toBeHidden();
    const first = await articleText(page);
    expect(first).toContain('Jessica was seven');
    await page.click('#nextPage');
    await expect(page.locator('#pageNum')).toHaveText(/^Page 2 of/);
    expect(await articleText(page)).not.toBe(first);
    await page.click('#prevPage');
    expect(await articleText(page)).toBe(first);
  });

  test('comes back to the same page after closing', async ({ page }) => {
    await openKite(page);
    await page.click('#nextPage');
    await page.click('#nextPage');
    await page.click('#readHome');
    await expect(page.getByRole('button', { name: /The Runaway Kite.*Page 3 of/ })).toBeVisible();
    await page.reload();
    await openKite(page);
    await expect(page.locator('#pageNum')).toHaveText(/^Page 3 of/);
  });

  test('finishing celebrates, logs it for Pam and starts over next time', async ({ page }) => {
    await openKite(page);
    const total = await page.evaluate(() => pagesOf(state.stories[0]).length);
    for (let i = 1; i < total; i++) await page.click('#nextPage');
    await expect(page.locator('#nextPage')).toHaveText('I finished!');
    await page.click('#nextPage');
    await expect(page.getByRole('heading', { name: 'Well done, Jessica!' })).toBeVisible();
    await expect(page.locator('#doneView')).not.toContainText(/\d/);
    await page.click('#doneAgain');
    await expect(page.locator('#pageNum')).toHaveText(/^Page 1 of/);
    await page.click('#readHome');
    await holdPamDoor(page);
    await expect(page.locator('#pamStories')).toContainText('Finished once');
  });

  test('uses her chosen look', async ({ page }) => {
    await page.evaluate(() => { state.settings.font = 'lexend'; state.settings.size = 30; changed(); });
    await openKite(page);
    const style = await page.locator('#paneA article').evaluate(el => {
      const c = getComputedStyle(el);
      return { font: c.fontFamily, size: c.fontSize };
    });
    expect(style.font).toContain('Lexend');
    expect(style.size).toBe('30px');
  });
});

test.describe('hearing words', () => {
  test('tapping a word says only that word, without its punctuation', async ({ page }) => {
    await openKite(page);
    await page.locator('#paneA .w', { hasText: /^tail\.\s*$/ }).first().click();
    await expect.poll(() => spoken(page)).toEqual(['tail']);
    const u = await lastSpoken(page);
    expect(u.lang).toBe('en-GB');
    expect(u.rate).toBeLessThanOrEqual(0.8);
  });

  test('tapping a word stops Listen and says the word', async ({ page }) => {
    await page.evaluate(() => { window.__holdSpeech = true; });
    await openKite(page);
    await page.click('#listen');
    await expect(page.locator('#listen')).toHaveText('Stop');
    await page.locator('#paneA .w').nth(2).click();
    await expect(page.locator('#listen')).toHaveText('Listen');
    await expect.poll(async () => (await spoken(page)).at(-1)).toBe('seven');
  });

  test('two quick taps only say the second word', async ({ page }) => {
    await page.evaluate(() => { window.__holdSpeech = true; });
    await openKite(page);
    await page.locator('#paneA .w').nth(2).click();
    await page.evaluate(() => {
      const w = document.querySelectorAll('#paneA .w');
      w[0].click(); w[4].click();
    });
    await page.waitForTimeout(200);
    expect((await spoken(page)).slice(1)).toEqual(['she']);
  });

  test('works on words with bold starts', async ({ page }) => {
    await page.evaluate(() => { state.settings.bionic = true; changed(); });
    await openKite(page);
    await page.locator('#paneA .w b').nth(3).click();
    await expect.poll(async () => (await spoken(page)).length).toBe(1);
    expect((await spoken(page))[0]).toMatch(/^\p{L}+$/u);
    expect(await articleText(page)).toContain('Jessica was seven');
  });

  test('Listen reads the whole page, one paragraph at a time', async ({ page }) => {
    await openKite(page);
    const paras = await page.evaluate(() => pagesOf(state.stories[0])[0].paras);
    await page.click('#listen');
    await expect.poll(() => spoken(page)).toEqual(paras);
    await expect(page.locator('#listen')).toHaveText('Listen');
  });

  test('turning the page stops Listen', async ({ page }) => {
    await page.evaluate(() => { window.__holdSpeech = true; });
    await openKite(page);
    await page.click('#listen');
    await page.click('#nextPage');
    await expect(page.locator('#listen')).toHaveText('Listen');
    expect(await page.evaluate(() => speechSynthesis.speaking)).toBe(false);
  });
});

test.describe('"Which is easier?" game', () => {
  const rounds = page => page.evaluate(() => GAME_ROUNDS.length);
  const card = (page, opt) => page.locator(`#gameCards [data-opt=${opt}]`);
  const fontOfCard = (page, opt) => card(page, opt).evaluate(el => getComputedStyle(el).fontFamily);
  async function playAll(page, opts) {
    for (let i = 0; i < opts.length; i++) {
      await expect(page.locator('#gameRound')).toHaveText(`Round ${i + 1} of ${opts.length}`);
      await card(page, opts[i]).click();
    }
    await expect(page.locator('#gameDone')).toBeVisible();
  }

  test('reads the question out when it starts', async ({ page }) => {
    await page.click('#playGame');
    await expect.poll(() => spoken(page)).toEqual(['Which one is easier to read? Tap it.']);
  });

  test('shows the same words in two different looks', async ({ page }) => {
    await page.click('#playGame');
    await expect(card(page, 'a')).toHaveText(await card(page, 'b').innerText());
    expect(await fontOfCard(page, 'a')).toContain('Andika');
    expect(await fontOfCard(page, 'b')).toContain('Comic Neue');
  });

  test('the winner of each round goes through to the next', async ({ page }) => {
    await page.click('#playGame');
    await card(page, 'b').click();
    await expect(page.locator('#gameRound')).toHaveText(/^Round 2/);
    expect(await fontOfCard(page, 'a')).toContain('Comic Neue');
    expect(await fontOfCard(page, 'b')).toContain('Lexend');
  });

  test('keeping the look applies every choice and survives a reload', async ({ page }) => {
    await page.click('#playGame');
    await playAll(page, ['b', 'a', 'b', 'b', 'b', 'b']);
    await expect(page.locator('#gameWinner')).toBeVisible();
    await page.click('#gameKeep');
    await expect(page.locator('#homeView')).toBeVisible();
    const expected = { font: 'comic', fg: '#14233a', bg: '#dcecfb', size: 30, lh: 2.1, ls: 0.03, ws: 0.15 };
    expect(await page.evaluate(() => state.settings)).toMatchObject(expected);
    await page.reload();
    expect(await page.evaluate(() => state.settings)).toMatchObject(expected);
  });

  test('"They look the same" keeps the look so far', async ({ page }) => {
    await page.click('#playGame');
    await card(page, 'b').click();
    await expect(page.locator('#gameRound')).toHaveText(/^Round 2/);
    await page.click('#gameSame');
    await expect(page.locator('#gameRound')).toHaveText(/^Round 3/);
    expect(await page.evaluate(() => game.look.font)).toBe('comic');
  });

  test('keeps her reading aids, and changes nothing unless she keeps the look', async ({ page }) => {
    await page.evaluate(() => { state.settings.ruler = 'tint'; state.settings.font = 'georgia'; changed(); });
    await page.click('#playGame');
    const n = await rounds(page);
    await playAll(page, Array(n).fill('a'));
    expect(await page.evaluate(() => state.settings.font)).toBe('georgia');
    await page.click('#gameKeep');
    expect(await page.evaluate(() => state.settings)).toMatchObject({ font: 'andika', ruler: 'tint' });
  });

  test('stopping changes nothing, even straight after a tap', async ({ page }) => {
    await page.click('#playGame');
    await card(page, 'b').click();
    await page.click('#gameStop');
    await page.waitForTimeout(400);
    await expect(page.locator('#homeView')).toBeVisible();
    expect(await page.evaluate(() => state.settings.font)).toBe('arial');
  });

  test('a double tap only counts once', async ({ page }) => {
    await page.click('#playGame');
    await card(page, 'b').evaluate(el => { el.click(); el.click(); });
    await expect(page.locator('#gameRound')).toHaveText(/^Round 2/);
    await page.waitForTimeout(400);
    await expect(page.locator('#gameRound')).toHaveText(/^Round 2/);
  });

  test('swaps sides, so she is not led by position', async ({ page }) => {
    await page.click('#playGame');
    const firstOpt = v => page.evaluate(r => {
      Math.random = () => r;
      renderRound();
      return document.querySelector('#gameCards button').dataset.opt;
    }, v);
    expect(await firstOpt(0.1)).toBe('a');
    expect(await firstOpt(0.9)).toBe('b');
  });

  test('every look in the game has strong contrast', async ({ page }) => {
    const lowest = await page.evaluate(() => Math.min(...[CREAM, WHITE, BLUE].map(c => contrast(c.fg, c.bg))));
    expect(lowest).toBeGreaterThanOrEqual(7);
  });
});

test.describe('reading checks', () => {
  async function timedCheck(page, seconds) {
    await page.click('#startCheck');
    await expect(page.locator('#checkBar')).toBeVisible();
    await page.evaluate(s => { check.start -= s * 1000; }, seconds);
    await page.click('#finishCheck');
  }

  test('shows Jessica no timer or number, during or after', async ({ page }) => {
    await holdPamDoor(page);
    await page.click('#startCheck');
    await expect(page.locator('#readBar')).toBeHidden();
    await expect(page.locator('#checkBar')).not.toContainText(/\d/);
    await expect(page.locator('#paneA article')).toContainText('red mitten');
    await page.evaluate(() => { check.start -= 120000; });
    await page.click('#finishCheck');
    await expect(page.getByRole('heading', { name: 'Well done, Jessica!' })).toBeVisible();
    await expect(page.locator('#doneView')).not.toContainText(/\d|minute/);
    await expect(page.locator('#doneAgain')).toBeHidden();
  });

  test('tells Pam then and now, using a new passage each time', async ({ page }) => {
    await holdPamDoor(page);
    await expect(page.locator('#thenNow')).toContainText('No checks yet');
    await timedCheck(page, 120);
    await page.click('#doneHome');
    await holdPamDoor(page);
    await expect(page.locator('#thenNow')).toContainText('One check saved');
    await timedCheck(page, 60);
    await page.click('#doneHome');
    await holdPamDoor(page);
    const c = await page.evaluate(() => state.checks.map(x => ({ id: x.id, wpm: x.wpm })));
    expect(c[0].id).toBe('mitten');
    expect(c[1].id).toBe('boat');
    expect(c[0].wpm).toBe(51);
    await expect(page.locator('#thenNow')).toContainText('about 51 words a minute');
    await expect(page.locator('#thenNow')).toContainText(`about ${c[1].wpm} words a minute`);
    await expect(page.locator('#thenNow')).toContainText('vary a lot');
  });

  test('does not save a mis-tap', async ({ page }) => {
    await holdPamDoor(page);
    await page.click('#startCheck');
    await page.click('#finishCheck');
    await expect(page.locator('#checkStatus')).toContainText("wasn't saved");
    expect(await page.evaluate(() => state.checks.length)).toBe(0);
  });

  test('cancelling saves nothing and reuses the passage', async ({ page }) => {
    await holdPamDoor(page);
    await page.click('#startCheck');
    await page.click('#cancelCheck');
    expect(await page.evaluate(() => state.checks.length)).toBe(0);
    await page.click('#startCheck');
    await expect(page.locator('#paneA article')).toContainText('red mitten');
  });

  test('Pam can delete a bad check', async ({ page }) => {
    await holdPamDoor(page);
    await timedCheck(page, 120);
    await page.click('#doneHome');
    await holdPamDoor(page);
    await page.locator('#checkList button').click();
    await expect(page.locator('#checkList li')).toHaveCount(0);
    expect(await page.evaluate(() => state.checks.length)).toBe(0);
  });

  test('warns when passages start to repeat', async ({ page }) => {
    await page.evaluate(() => {
      state.checks = CHECKS.map(c => ({ id: c.id, words: 100, ms: 90000, wpm: 66, at: '2026-01-01T10:00:00Z', settings: {} }));
    });
    await holdPamDoor(page);
    await expect(page.locator('#checkRepeat')).toBeVisible();
  });

  test('passages are all a similar length', async ({ page }) => {
    const lengths = await page.evaluate(() => CHECKS.map(c => countWords(c.text)));
    expect(lengths).toHaveLength(6);
    for (const n of lengths) expect(Math.abs(n - 100)).toBeLessThanOrEqual(5);
  });
});

test.describe("Pam's page", () => {
  test('adds a story that appears on the shelf', async ({ page }) => {
    await holdPamDoor(page);
    await addStory(page, 'Otters', 'The otter swam. It was fun.');
    await backHome(page);
    await page.getByRole('button', { name: 'Otters' }).click();
    await expect(page.locator('#paneA article')).toContainText('The otter swam.');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Otters' })).toBeVisible();
  });

  test('needs story text, but makes up a title if there is none', async ({ page }) => {
    await holdPamDoor(page);
    await page.click('#saveStory');
    await expect(page.locator('#storyStatus')).toContainText('story first');
    await addStory(page, '', 'One two three four five six seven.');
    await expect(page.locator('#pamStories')).toContainText('One two three four five');
  });

  test('edits a story and starts it from the beginning', async ({ page }) => {
    await page.evaluate(() => { state.stories[0].page = 3; });
    await holdPamDoor(page);
    await page.getByRole('button', { name: 'Edit The Runaway Kite' }).click();
    await expect(page.locator('#newTitle')).toHaveValue('The Runaway Kite');
    await addStory(page, 'New title', 'New words.');
    expect(await page.evaluate(() => state.stories)).toMatchObject([{ title: 'New title', text: 'New words.', page: 0 }]);
  });

  test('deletes a story', async ({ page }) => {
    await holdPamDoor(page);
    await page.getByRole('button', { name: 'Delete The Runaway Kite' }).click();
    await backHome(page);
    await expect(page.locator('#shelf')).toContainText('Pam can add a story');
  });

  test('shows a title as plain text', async ({ page }) => {
    await holdPamDoor(page);
    await addStory(page, '<img src=x onerror="window.hacked=1">', 'Words.');
    await backHome(page);
    await expect(page.locator('#shelf img')).toHaveCount(0);
    expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  });

  test('shows the Home Screen steps only in iPad Safari', async ({ page }) => {
    await holdPamDoor(page);
    await page.evaluate(() => { Object.defineProperty(navigator, 'standalone', { value: false, configurable: true }); renderPam(); });
    await expect(page.locator('#pamSetup')).toBeVisible();
    await page.evaluate(() => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); renderPam(); });
    await expect(page.locator('#pamSetup')).toBeHidden();
  });

  test('can reach the full tools and come back', async ({ page }) => {
    await holdPamDoor(page);
    await page.click('#openAdvanced');
    await expect(page.locator('#tab-test')).toBeVisible();
    await page.click('#advancedBack');
    await expect(page.locator('#pamView')).toBeVisible();
    await backHome(page);
    await expect(page.locator('#tabs')).toBeHidden();
  });

  test('a safe copy restores stories, look and checks', async ({ page }) => {
    await page.evaluate(() => {
      state.settings.font = 'lexend';
      state.checks = [{ id: 'cat', words: 98, ms: 90000, wpm: 65, at: '2026-01-01T10:00:00Z', settings: {} }];
    });
    await holdPamDoor(page);
    await addStory(page, 'Keep me', 'Words to keep.');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]);
    const file = test.info().outputPath('copy.json');
    await download.saveAs(file);

    await page.evaluate(() => { clearTimeout(saveTimer); localStorage.clear(); state.stories = []; state.checks = []; state.settings.font = 'arial'; saveNow(); });
    await page.locator('#restoreFile').setInputFiles(file);
    await expect(page.getByRole('button', { name: 'Keep me', exact: true })).toBeVisible();
    const after = await page.evaluate(() => ({ font: state.settings.font, checks: state.checks.length }));
    expect(after).toEqual({ font: 'lexend', checks: 1 });
  });

  test('refuses a file that is not a safe copy', async ({ page }) => {
    await holdPamDoor(page);
    const file = test.info().outputPath('bad.json');
    fs.writeFileSync(file, '{"nope":1}');
    await page.locator('#restoreFile').setInputFiles(file);
    await expect(page.locator('#backupStatus')).toContainText('nothing was changed');
    expect(await page.evaluate(() => state.stories.length)).toBe(1);
  });

  test('ignores damaged saved data', async ({ page }) => {
    await page.evaluate(() => {
      clearTimeout(saveTimer); saveTimer = 0;
      localStorage.setItem(STORE_KEY, JSON.stringify({ stories: [{ title: 'No text' }, 7], checks: [{ wpm: 'x' }] }));
    });
    await page.reload();
    const s = await page.evaluate(() => ({ stories: state.stories.length, checks: state.checks.length }));
    expect(s).toEqual({ stories: 0, checks: 0 });
  });
});

test.describe('fits the iPad', () => {
  async function noSideScroll(page) {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
  }
  async function bigEnoughButtons(page) {
    const small = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter(b => b.offsetParent && b.getBoundingClientRect().height < 44 && !b.classList.contains('small'))
      .map(b => b.textContent));
    expect(small).toEqual([]);
  }
  test('home', async ({ page }) => { await noSideScroll(page); await bigEnoughButtons(page); });

  test('game', async ({ page }) => {
    await page.click('#playGame');
    await noSideScroll(page);
    await bigEnoughButtons(page);
    const fit = await page.evaluate(() => [...document.querySelectorAll('#gameSame,#gameCards button')]
      .every(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
    expect(fit).toBe(true);
  });

  test('reader, with the page buttons on screen', async ({ page }) => {
    await page.evaluate(() => { state.settings.size = 40; state.settings.lh = 3; changed(); });
    await openKite(page);
    await noSideScroll(page);
    await bigEnoughButtons(page);
    await expect(page.locator('#nextPage')).toBeInViewport();
    await expect(page.locator('#listen')).toBeInViewport();
    expect(await page.locator('#paneA').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(200);
  });
});
