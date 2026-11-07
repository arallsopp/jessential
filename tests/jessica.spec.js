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
  await page.click('#who-jessica');
});
const pickReader = (page, id) => page.click('#who-' + id);

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
  test('opens on her stories, with no settings or tabs, after she picks her name', async ({ page }) => {
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
    await pickReader(page, 'jessica');
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

test.describe('"Which is easier?" games', () => {
  const card = (page, opt) => page.locator(`#gameCards [data-opt=${opt}]`);
  const lookOf = (page, opt) => card(page, opt).evaluate(el => el._look);
  async function startPart(page, name) {
    if (await page.locator('#playGame').isVisible()) await page.click('#playGame');
    await page.locator('#parts button', { hasText: name }).click();
    await expect(page.locator('#gameRound')).toHaveText('Round 1');
  }
  // Plays like a child with a clear preference: picks the card that scores higher.
  async function playPart(page, name, score) {
    await startPart(page, name);
    const offered = [];
    while (await page.locator('#gamePlay').isVisible()) {
      const prev = await page.locator('#gameRound').innerText();
      const choice = await page.evaluate(src => {
        const f = eval('(' + src + ')');
        const [x, y] = [...document.querySelectorAll('#gameCards button')].map(c => ({ opt: c.dataset.opt, s: f(c._look), look: c._look }));
        return { opt: x.s === y.s ? 'same' : x.s > y.s ? x.opt : y.opt, b: (x.opt === 'b' ? x : y).look, phase: game.phase };
      }, score.toString());
      offered.push(choice);
      if (choice.opt === 'same') await page.click('#gameSame');
      else await card(page, choice.opt).click();
      await page.waitForFunction(p => document.querySelector('#gameRound').textContent !== p
        || !document.querySelector('#gameDone').hidden, prev);
    }
    return offered;
  }
  const settings = page => page.evaluate(() => state.settings);
  const setLook = (page, look) => page.evaluate(l => { Object.assign(state.settings, l); changed(); }, look);

  test('offers five games, and stars the ones she has played', async ({ page }) => {
    await page.click('#playGame');
    await expect(page.locator('#parts button')).toHaveText([/Letters/, /Size/, /Spacing/, /Colours/, /Helpers/]);
    await expect(page.locator('#parts .next')).toHaveText(/Letters/);
    await playPart(page, 'Letters', () => 0);
    await page.click('#gameKeep');
    await expect(page.locator('#parts button').first()).toHaveAttribute('aria-label', 'Letters, played');
    await expect(page.locator('#parts .next')).toHaveText(/Size/);
  });

  test('reads the question out when a game starts', async ({ page }) => {
    await startPart(page, 'Colours');
    await expect.poll(() => spoken(page)).toEqual(['Which colour is easier on your eyes? Tap it.']);
  });

  test('starts from her current look', async ({ page }) => {
    await setLook(page, { font: 'lexend', size: 32, fg: '#14233a', bg: '#dcecfb', stripes: true });
    await startPart(page, 'Letters');
    expect(await lookOf(page, 'a')).toMatchObject({ font: 'lexend', size: 32, bg: '#dcecfb', stripes: true });
    const b = await lookOf(page, 'b');
    expect(b.font).not.toBe('lexend');
    expect(b).toMatchObject({ size: 32, bg: '#dcecfb', stripes: true });
  });

  test('letters: tries every other font, at the same letter height', async ({ page }) => {
    const offered = await playPart(page, 'Letters', l => (l.font === 'arial' ? 1 : 0));
    const fonts = offered.map(o => o.b.font);
    expect(new Set(fonts)).toEqual(new Set(['verdana', 'georgia', 'opendyslexic', 'atkinson', 'lexend', 'andika', 'comic']));
    await expect(page.locator('#gameDoneTitle')).toHaveText('Your look is just right!');
    expect(offered.every(o => o.phase === 'explore')).toBe(true);
  });

  test('letters: cards use the same letter height where the browser supports it', async ({ page }) => {
    await startPart(page, 'Letters');
    const r = await card(page, 'a').evaluate(el => ({ ok: CSS.supports('font-size-adjust', '0.5'), v: getComputedStyle(el).fontSizeAdjust }));
    if (r.ok) expect(r.v).toBe('0.5');
  });

  test('letters: a font she likes better is checked again before it is kept', async ({ page }) => {
    const offered = await playPart(page, 'Letters', l => (l.font === 'andika' ? 2 : l.font === 'arial' ? 1 : 0));
    const last = offered.at(-1);
    expect(last.phase).toBe('confirm');
    expect(last.b.font).toBe('arial');
    await expect(page.locator('#gameDoneTitle')).toHaveText('This is your new look!');
    expect((await settings(page)).font).toBe('arial');
    await page.click('#gameKeep');
    expect((await settings(page)).font).toBe('andika');
  });

  test('a change she does not pick twice is not kept, and Pam sees it was close', async ({ page }) => {
    // Prefers Comic Neue at first, then goes back to Arial when asked again.
    await page.evaluate(() => { window.__confirming = () => game.phase === 'confirm'; });
    const offered = await playPart(page, 'Letters', l => {
      if (window.__confirming()) return l.font === 'arial' ? 1 : 0;
      return l.font === 'comic' ? 1 : 0;
    });
    expect(offered.at(-1).phase).toBe('confirm');
    await expect(page.locator('#gameDoneTitle')).toHaveText('Your look is just right!');
    await page.click('#gameKeep');
    expect((await settings(page)).font).toBe('arial');
    await page.click('#lookHome');
    await holdPamDoor(page);
    await expect(page.locator('#lookSummary')).toContainText('kept Arial');
    await expect(page.locator('#lookSummary')).toContainText('picked Comic Neue at first');
  });

  test('"They look the same" never changes her look', async ({ page }) => {
    await playPart(page, 'Colours', () => 0);
    await page.click('#gameKeep');
    expect(await settings(page)).toMatchObject({ fg: '#111111', bg: '#ffffff' });
  });

  for (const [start, target] of [[20, 30], [20, 22], [20, 40], [28, 18], [36, 34]]) {
    test(`size: from ${start}px, finds ${target}px`, async ({ page }) => {
      await setLook(page, { size: start });
      const offered = await playPart(page, 'Size', new Function('l', `return -Math.abs(l.size - ${target})`));
      expect(offered.length).toBeLessThanOrEqual(8);
      await page.click('#gameKeep');
      expect((await settings(page)).size).toBe(target);
    });
  }

  test('spacing: moves up to the spacing she likes', async ({ page }) => {
    await playPart(page, 'Spacing', l => -Math.abs(l.lh - 2.2));
    await page.click('#gameKeep');
    expect(await settings(page)).toMatchObject({ lh: 2.2, ls: 0.04, ws: 0.16 });
  });

  test('spacing: can also go tighter', async ({ page }) => {
    await setLook(page, { lh: 1.9, ls: 0.02, ws: 0.08 });
    await playPart(page, 'Spacing', l => -Math.abs(l.lh - 1.4));
    await page.click('#gameKeep');
    expect((await settings(page)).lh).toBe(1.4);
  });

  test('colours: tries all the other colours', async ({ page }) => {
    const offered = await playPart(page, 'Colours', l => (l.bg === '#dcecfb' ? 1 : 0));
    const bgs = new Set(offered.filter(o => o.phase === 'explore').map(o => o.b.bg));
    expect(bgs.size).toBe(7);
    await page.click('#gameKeep');
    expect(await settings(page)).toMatchObject({ fg: '#14233a', bg: '#dcecfb' });
  });

  test('helpers: keeps only the aid she prefers, and shows each one', async ({ page }) => {
    const offered = await playPart(page, 'Helpers', l => (l.stripes ? 1 : 0) - (l.bionic ? 1 : 0) - (l.ruler !== 'off' ? 1 : 0));
    const tried = offered.filter(o => o.phase === 'explore').map(o => o.b);
    expect(tried.some(l => l.bionic)).toBe(true);
    expect(tried.some(l => l.ruler === 'tint')).toBe(true);
    expect(tried.some(l => l.ruler === 'mask')).toBe(true);
    expect(offered.filter(o => o.phase === 'confirm')).toHaveLength(1);
    await page.click('#gameKeep');
    expect(await settings(page)).toMatchObject({ stripes: true, bionic: false, ruler: 'off' });
  });

  test('helpers: the cards show stripes, bold starts and the ruler', async ({ page }) => {
    await setLook(page, { stripes: true, ruler: 'tint', bionic: true });
    await startPart(page, 'Helpers');
    const a = card(page, 'a');
    await expect(a.locator('.w.odd').first()).toBeAttached();
    await expect(a.locator('.w b').first()).toBeAttached();
    const band = await a.locator('.band').evaluate(el => ({ h: el.getBoundingClientRect().height, cls: el.className }));
    expect(band.cls).toContain('band-tint');
    expect(band.h).toBeGreaterThan(10);
  });

  test('keeping a game only changes what that game is about', async ({ page }) => {
    await setLook(page, { font: 'lexend', stripes: true, ruler: 'mask' });
    await playPart(page, 'Size', l => l.size);
    await page.click('#gameKeep');
    expect(await settings(page)).toMatchObject({ font: 'lexend', stripes: true, ruler: 'mask', size: 40 });
  });

  test('stopping changes nothing and records nothing, even straight after a tap', async ({ page }) => {
    await startPart(page, 'Letters');
    await card(page, 'b').click();
    await page.click('#gameStop');
    await page.waitForTimeout(400);
    await expect(page.locator('#lookView')).toBeVisible();
    expect((await settings(page)).font).toBe('arial');
    expect(await page.evaluate(() => state.lookLog)).toEqual({});
  });

  test('a double tap only counts once', async ({ page }) => {
    await startPart(page, 'Letters');
    await card(page, 'b').evaluate(el => { el.click(); el.click(); });
    await expect(page.locator('#gameRound')).toHaveText('Round 2');
    await page.waitForTimeout(400);
    await expect(page.locator('#gameRound')).toHaveText('Round 2');
  });

  test('swaps sides, so she is not led by position', async ({ page }) => {
    await startPart(page, 'Letters');
    const firstOpt = v => page.evaluate(r => {
      Math.random = () => r;
      renderRound();
      return document.querySelector('#gameCards button').dataset.opt;
    }, v);
    expect(await firstOpt(0.1)).toBe('a');
    expect(await firstOpt(0.9)).toBe('b');
  });

  test('cards show only the sample words, with or without a ruler', async ({ page }) => {
    for (const ruler of ['off', 'tint']) {
      await page.evaluate(r => { state.settings.ruler = r; changed(); }, ruler);
      await startPart(page, 'Letters');
      for (const opt of ['a', 'b']) {
        const text = (await card(page, opt).innerText()).trim();
        expect(await page.evaluate(t => SENTENCES.includes(t.replace(/\s+/g, ' ')), text)).toBe(true);
      }
      await page.click('#gameStop');
      await page.click('#lookHome');
    }
  });

  test('a card does not stay highlighted after a tap', async ({ page }) => {
    await startPart(page, 'Letters');
    await card(page, 'a').hover();
    const colours = await page.evaluate(() => [...document.querySelectorAll('#gameCards button')].map(b => getComputedStyle(b).borderTopColor));
    expect(colours[0]).toBe(colours[1]);
  });

  test('uses new words each round', async ({ page }) => {
    await startPart(page, 'Letters');
    const first = await card(page, 'a').innerText();
    await card(page, 'a').click();
    await expect(page.locator('#gameRound')).toHaveText('Round 2');
    expect(await card(page, 'a').innerText()).not.toBe(first);
  });

  test('every colour in the game has strong contrast', async ({ page }) => {
    const lowest = await page.evaluate(() => Math.min(...GAME_COLOURS.map(c => contrast(c.fg, c.bg))));
    expect(lowest).toBeGreaterThanOrEqual(7);
  });

  test("Pam's page shows what each game found", async ({ page }) => {
    await playPart(page, 'Size', l => -Math.abs(l.size - 30));
    await page.click('#gameKeep');
    await page.click('#lookHome');
    await holdPamDoor(page);
    await expect(page.locator('#lookSummary')).toContainText('Size');
    await expect(page.locator('#lookSummary')).toContainText('changed from 20px to 30px, picked twice');
    await expect(page.locator('#lookNow')).toContainText('30px');
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
    await pickReader(page, 'jessica');
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
    await pickReader(page, 'jessica');
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

  test('resetting her look keeps her stories and reading checks', async ({ page }) => {
    await page.evaluate(() => {
      Object.assign(state.settings, { font: 'lexend', size: 34, stripes: true, ruler: 'mask' });
      state.lookLog = { size: { at: '2026-11-01T10:00:00Z', from: '20px', to: '34px', changed: true } };
      state.ttsRate = 1.3;
      state.stories[0].page = 2;
      state.checks = [{ id: 'cat', words: 98, ms: 90000, wpm: 65, at: '2026-01-01T10:00:00Z', settings: {} }];
      changed();
    });
    await holdPamDoor(page);
    await addStory(page, 'Keep me', 'Words to keep.');
    await page.click('#resetPrefs');
    await expect(page.locator('#resetStatus')).toContainText('still here');
    await expect(page.locator('#lookSummary')).toContainText("hasn't played");
    await page.reload();
    const s = await page.evaluate(() => ({ settings: state.settings, defaults: DEFAULTS, log: state.lookLog, rate: state.ttsRate,
      stories: state.stories.map(x => x.title), page: state.stories[0].page, checks: state.checks.length }));
    expect(s.settings).toEqual(s.defaults);
    expect(s.log).toEqual({});
    // Read-aloud speed is shared by both children, so resetting one child's look keeps it.
    expect(s.rate).toBe(1.3);
    expect(s.stories).toEqual(['The Runaway Kite', 'Keep me']);
    expect(s.page).toBe(2);
    expect(s.checks).toBe(1);
  });

  test('erasing everything starts again with just the kite story', async ({ page }) => {
    await page.evaluate(() => {
      state.settings.font = 'lexend';
      state.checks = [{ id: 'cat', words: 98, ms: 90000, wpm: 65, at: '2026-01-01T10:00:00Z', settings: {} }];
    });
    await holdPamDoor(page);
    await addStory(page, 'Gone soon', 'Words.');
    let message = '';
    page.removeAllListeners('dialog');
    page.on('dialog', d => { message = d.message(); d.accept(); });
    await page.click('#eraseAll');
    await expect(page.locator('#whoView')).toBeVisible();
    expect(message).toMatch(/stories.*look.*reading checks.*game results/);
    const s = await page.evaluate(() => ({ font: state.settings.font, stories: state.stories.map(x => x.title), checks: state.checks.length }));
    expect(s).toEqual({ font: 'arial', stories: ['The Runaway Kite'], checks: 0 });
  });

  test('saying no to either reset changes nothing', async ({ page }) => {
    await page.evaluate(() => { state.settings.font = 'lexend'; changed(); });
    await holdPamDoor(page);
    page.removeAllListeners('dialog');
    page.on('dialog', d => d.dismiss());
    await page.click('#resetPrefs');
    await page.click('#eraseAll');
    expect(await page.evaluate(() => state.settings.font)).toBe('lexend');
    await expect(page.locator('#pamView')).toBeVisible();
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

test.describe('Zachary', () => {
  const titles = page => page.locator('#shelf button').allInnerTexts();

  test('the app asks who is reading', async ({ page }) => {
    await page.reload();
    await expect(page.getByRole('heading', { name: "Who's reading?" })).toBeVisible();
    await expect(page.locator('#whoCards button')).toHaveText(['Jessica', 'Zachary']);
  });

  test('has his own page, with his own story', async ({ page }) => {
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    await expect(page.getByRole('heading', { name: 'Hello, Zachary!' })).toBeVisible();
    expect(await titles(page)).toEqual(['Zachary and the Big Digger']);
    await page.click('#notMe');
    await pickReader(page, 'jessica');
    expect(await titles(page)).toEqual(['The Runaway Kite']);
  });

  test('his story has Dad in it, on short pages of one paragraph each', async ({ page }) => {
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    const pages = await page.evaluate(() => pagesOf(state.stories[0]));
    expect(pages).toHaveLength(11);
    for (const p of pages) expect(p.paras).toHaveLength(1);
    const text = pages.flatMap(p => p.paras).join(' ');
    expect(text).toContain('"I am going to dig a pond," he said.');
    expect(text).toContain('"Oh no!" said Dad.');
    expect(text).not.toMatch(/\b(Kit|she|her)\b/);
    await page.getByRole('button', { name: 'Zachary and the Big Digger' }).click();
    await expect(page.locator('#pageNum')).toHaveText('Page 1 of 11');
    await expect(page.locator('#paneA article')).toHaveText(/^Zachary has a little red digger\. It can dig\. Dig, dig, dig!\s*$/);
  });

  test('starts with big, learner-friendly letters, separate from Jessica', async ({ page }) => {
    await page.evaluate(() => { state.settings.font = 'lexend'; changed(); });
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    expect(await page.evaluate(() => state.settings)).toMatchObject({ font: 'andika', size: 36 });
    await page.getByRole('button', { name: 'Zachary and the Big Digger' }).click();
    expect(await page.locator('#paneA article').evaluate(el => getComputedStyle(el).fontSize)).toBe('36px');
    await page.click('#readHome');
    await page.click('#notMe');
    await pickReader(page, 'jessica');
    expect((await page.evaluate(() => state.settings)).font).toBe('lexend');
  });

  test('his games change only his look, and have their own stars', async ({ page }) => {
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    await page.click('#playGame');
    await page.locator('#parts button', { hasText: 'Size' }).click();
    await page.evaluate(() => { game.best.size = 40; game.phase = 'confirm'; game.confirms = []; game.challenger = { size: 36 }; });
    await page.click('#gameSame');
    await page.click('#gameKeep');
    await expect(page.locator('#parts button').nth(1)).toHaveAttribute('aria-label', 'Size, played');
    await page.click('#lookHome');
    await page.click('#notMe');
    await pickReader(page, 'jessica');
    await page.click('#playGame');
    await expect(page.locator('#parts .star')).toHaveCount(0);
    expect((await page.evaluate(() => state.settings)).size).toBe(20);
  });

  test("Pam's page switches between them, and stories go to the right child", async ({ page }) => {
    await holdPamDoor(page);
    await expect(page.locator('#storiesTitle')).toHaveText("Jessica's stories");
    await expect(page.locator('#checkSection')).toBeVisible();
    await page.locator('#readerSwitch button', { hasText: 'Zachary' }).click();
    await expect(page.locator('#storiesTitle')).toHaveText("Zachary's stories");
    await expect(page.locator('#checkSection')).toBeHidden();
    await expect(page.locator('#storyHint')).toContainText('own page');
    await expect(page.locator('#pamBack')).toHaveText("Back to Zachary's stories");
    await addStory(page, 'Big Truck', 'The truck is big.\n\nIt goes beep.');
    await page.click('#pamBack');
    await expect(page.getByRole('heading', { name: 'Hello, Zachary!' })).toBeVisible();
    expect(await titles(page)).toEqual(['Zachary and the Big Digger', 'Big Truck']);
    await page.getByRole('button', { name: 'Big Truck' }).click();
    await expect(page.locator('#pageNum')).toHaveText('Page 1 of 2');
    await page.click('#readHome');
    await page.click('#notMe');
    await pickReader(page, 'jessica');
    expect(await titles(page)).toEqual(['The Runaway Kite']);
  });

  test('both profiles survive a reload and a safe copy', async ({ page }) => {
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    await page.evaluate(() => { state.settings.size = 40; state.stories[0].page = 4; changed(); });
    await holdPamDoor(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backup')]);
    const file = test.info().outputPath('copy.json');
    await download.saveAs(file);
    await page.reload();
    await pickReader(page, 'zachary');
    expect(await page.evaluate(() => ({ size: state.settings.size, page: state.stories[0].page }))).toEqual({ size: 40, page: 4 });
    await page.evaluate(() => { clearTimeout(saveTimer); saveTimer = 0; localStorage.clear(); });
    await holdPamDoor(page);
    await page.locator('#restoreFile').setInputFiles(file);
    await pickReader(page, 'zachary');
    expect(await page.evaluate(() => state.settings.size)).toBe(40);
  });

  test('data saved before Zachary existed keeps Jessica and adds him', async ({ page }) => {
    await page.evaluate(() => {
      clearTimeout(saveTimer); saveTimer = 0;
      localStorage.setItem(STORE_KEY, JSON.stringify({
        settings: { ...DEFAULTS, font: 'comic' },
        stories: [{ id: 'old', title: 'Old story', text: 'Old words.', page: 0, reads: [] }],
        lookLog: { letters: { at: '2026-11-07T10:00:00Z', from: 'Arial', to: 'Comic Neue', changed: true } },
      }));
    });
    await page.reload();
    await pickReader(page, 'jessica');
    expect(await titles(page)).toEqual(['Old story']);
    expect((await page.evaluate(() => state.settings)).font).toBe('comic');
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    expect(await titles(page)).toEqual(['Zachary and the Big Digger']);
  });

  test("resetting Zachary's look goes back to his starting look and leaves Jessica's alone", async ({ page }) => {
    await page.evaluate(() => { state.settings.font = 'lexend'; changed(); });
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    await page.evaluate(() => { state.settings.size = 22; state.settings.font = 'georgia'; changed(); });
    await holdPamDoor(page);
    await expect(page.locator('#resetPrefs')).toHaveText("Reset Zachary's look");
    await page.click('#resetPrefs');
    expect(await page.evaluate(() => state.settings)).toMatchObject({ font: 'andika', size: 36 });
    await page.locator('#readerSwitch button', { hasText: 'Jessica' }).click();
    expect((await page.evaluate(() => state.settings)).font).toBe('lexend');
  });

  test('his games use his simpler sentences, and Jessica keeps hers', async ({ page }) => {
    const cardText = () => page.locator('#gameCards button').first().innerText().then(t => t.trim().replace(/\s+/g, ' '));
    const pools = await page.evaluate(() => ({ z: [...readerInfo('zachary').sentence, ...readerInfo('zachary').paragraph], j: [...SENTENCES, ...PARAGRAPHS] }));
    for (const sample of pools.z) for (const sentence of sample.split(/(?<=[.!?])\s+/)) {
      expect(sentence.split(' ').length).toBeLessThanOrEqual(7);
    }
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    for (const part of ['Letters', 'Helpers']) {
      await page.click('#playGame');
      await page.locator('#parts button', { hasText: part }).click();
      expect(pools.z).toContain(await cardText());
      await page.click('#gameStop');
      await page.click('#lookHome');
    }
    await page.click('#playGame');
    await page.locator('#parts button', { hasText: 'Size' }).click();
    await page.evaluate(() => { game.queue = []; game.ladder.refine = []; game.ladder.cur = 0; game.ladder.dir = 1; game.ladder.step = 0; });
    await page.click('#gameSame');
    await expect(page.locator('#gameWinner')).toHaveText('The big digger digs in the mud.');
    await page.click('#gameKeep');
    await page.click('#lookHome');
    await page.click('#notMe');
    await pickReader(page, 'jessica');
    await page.click('#playGame');
    await page.locator('#parts button', { hasText: 'Letters' }).click();
    expect(pools.j).toContain(await cardText());
  });

  test('says well done to the right child', async ({ page }) => {
    await page.click('#notMe');
    await pickReader(page, 'zachary');
    await page.getByRole('button', { name: 'Zachary and the Big Digger' }).click();
    for (let i = 0; i < 11; i++) await page.click('#nextPage');
    await expect(page.getByRole('heading', { name: 'Well done, Zachary!' })).toBeVisible();
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

  test('game choices', async ({ page }) => {
    await page.click('#playGame');
    await noSideScroll(page);
    await bigEnoughButtons(page);
  });

  test('game, with the largest text and spacing', async ({ page }) => {
    await page.evaluate(() => { Object.assign(state.settings, { size: 40, lh: 2.6, ls: 0.06, ws: 0.25 }); changed(); });
    await page.click('#playGame');
    await page.locator('#parts button', { hasText: 'Helpers' }).click();
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

test.describe('no zooming by double-tap', () => {
  // Every element must block double-tap zoom ('manipulation'), or block all gestures ('none').
  const zoomable = page => page.evaluate(() => [...document.querySelectorAll('body, body *')]
    .filter(el => el.getClientRects().length && !['manipulation', 'none'].includes(getComputedStyle(el).touchAction))
    .map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')).slice(0, 10));

  test('nothing on any screen zooms when tapped twice', async ({ page }) => {
    expect(await zoomable(page)).toEqual([]);              // her home
    await openKite(page);
    expect(await zoomable(page)).toEqual([]);              // reading
    await page.click('#readHome');
    await page.click('#playGame');
    expect(await zoomable(page)).toEqual([]);              // games
    await page.click('#lookHome');
    await holdPamDoor(page);
    expect(await zoomable(page)).toEqual([]);              // Pam's page
    await backHome(page);
    await page.click('#notMe');
    expect(await zoomable(page)).toEqual([]);              // who's reading
  });

  test('pinch zoom is still allowed, for anyone who needs it', async ({ page }) => {
    const vp = await page.locator('meta[name=viewport]').getAttribute('content');
    expect(vp).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\D|$)/);
  });

  test('text boxes are big enough that iOS does not zoom into them', async ({ page }) => {
    await holdPamDoor(page);
    for (const id of ['#newTitle', '#newText']) {
      expect(parseFloat(await page.locator(id).evaluate(el => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    }
  });
});
