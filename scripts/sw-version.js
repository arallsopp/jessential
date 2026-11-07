// Works out the service worker VERSION from the files it caches.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SW = path.join(ROOT, 'sw.js');

function readSw() { return fs.readFileSync(SW, 'utf8'); }
function cachedFiles(src = readSw()) {
  const list = src.match(/const FILES = \[([\s\S]*?)\];/);
  if (!list) throw new Error('FILES list not found in sw.js');
  return [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}
function currentVersion(src = readSw()) {
  const m = src.match(/const VERSION = '([^']*)';/);
  if (!m) throw new Error('VERSION not found in sw.js');
  return m[1];
}
function expectedVersion(src = readSw()) {
  const hash = crypto.createHash('sha256');
  for (const f of cachedFiles(src)) {
    hash.update(f + '\0');
    hash.update(fs.readFileSync(path.join(ROOT, f)));
  }
  return hash.digest('hex').slice(0, 12);
}
module.exports = { ROOT, SW, readSw, cachedFiles, currentVersion, expectedVersion };
