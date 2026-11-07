# Jessential!

A reading companion for Jessica and Zachary, on an iPad at Pam's. It opens on "Who's reading?", and each child has their own stories and look. Zachary's stories show one short paragraph per page. They play "Which is easier?" to tune their look, then read stories page by page. She can tap any word to hear it, or listen to a page before reading it herself.

Pam's page opens with a press and hold. It holds the stories, occasional timed reading checks and a safe copy of the data. "All settings and tools" leads to the fonts, colours, reading aids, setups and links.

It is a static page with no back end. All data stays in the browser's `localStorage`. On an iPad, add it to the Home Screen before adding stories: Safari can delete saved data from a site that hasn't been opened for 7 days.

## Host on GitHub Pages

Push this folder to a GitHub repository. Then go to **Settings → Pages**, and deploy from your branch's root folder.

To run it locally, use `python3 -m http.server`.

## Releasing an update

The app is installable and works offline. A service worker (`sw.js`) caches the files, and devices spot a new release when the app is next opened. They offer "Update now" on the "Who's reading?" screen and on Pam's page, never during a story or game. Saved stories and looks stay in `localStorage` and are never touched by an update.

Before you push a change, run `npm run stamp`. This sets the version in `sw.js` from the cached files. Without it, devices keep the old version. The tests fail if you forget.

## Tests

The site has no dependencies, but its browser tests use [Playwright](https://playwright.dev) and need Node and Python 3.

```sh
npm install
npx playwright install chromium
npm test
```

## Fonts

The `fonts/` folder holds Latin subsets of OpenDyslexic, Atkinson Hyperlegible, Lexend, Andika and Comic Neue, from [Fontsource](https://fontsource.org). All are under the SIL Open Font License, and each licence file is next to its font. Characters outside the Latin subset use a fallback font.
