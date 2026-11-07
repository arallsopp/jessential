// Run before deploying: `npm run stamp`. Sets sw.js VERSION from the cached files.
const fs = require('fs');
const { SW, readSw, currentVersion, expectedVersion } = require('./sw-version');

const src = readSw();
const before = currentVersion(src), after = expectedVersion(src);
if (before === after) {
  console.log(`sw.js is already stamped ${after}.`);
} else {
  fs.writeFileSync(SW, src.replace(`const VERSION = '${before}';`, `const VERSION = '${after}';`));
  console.log(`sw.js stamped ${after} (was ${before}).`);
}
