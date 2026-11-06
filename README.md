# Jessential!

Paste a story, then compare fonts, colours and reading aids to find out what makes it easiest to read. It is a static page with no back end. All data stays in the browser's `localStorage`.

## Host on GitHub Pages

Push this folder to a GitHub repository. Then go to **Settings → Pages**, and deploy from your branch's root folder.

To run it locally, use `python3 -m http.server`.

## Fonts

The `fonts/` folder holds Latin subsets of OpenDyslexic, Atkinson Hyperlegible, Lexend, Andika and Comic Neue, from [Fontsource](https://fontsource.org). All are under the SIL Open Font License, and each licence file is next to its font. Characters outside the Latin subset use a fallback font.
